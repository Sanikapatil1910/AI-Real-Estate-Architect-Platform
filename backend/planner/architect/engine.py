"""Multi-floor orchestration: candidate search, scoring and selection of four plans."""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from backend.planner.architect.doors import plan_openings
from backend.planner.architect.evaluate import FloorEval, evaluate_floor, vastu_score
from backend.planner.architect.feasibility import _site_and_program, analyse, available_box
from backend.planner.architect.geometry import Room
from backend.planner.architect.layout import Pin, build_struct, realise
from backend.planner.architect.program import FloorProgram, Program, RoomSpec
from backend.planner.architect.rules import STRICT, BEDROOM_TYPES, GRID, rule_for
from backend.planner.architect.site import Site, snap_down

# --------------------------------------------------------------------------------
# Result containers
# --------------------------------------------------------------------------------
@dataclass
class FloorSol:
    rooms: List[Room]
    ev: FloorEval
    cost: float
    family: str


@dataclass
class PlanSol:
    floors: List[FloorSol]
    F: float
    D: float
    family: str
    pin: Optional[Pin]
    mirror: bool = False
    feats: Dict[str, float] = field(default_factory=dict)
    vastu: float = 1.0
    score: float = 0.0
    label: str = ""
    notes: List[str] = field(default_factory=list)
    program: Any = None
    u_off: float = 0.0


# Weights per "design profile" - each of the four plans is picked under a different one.
PROFILES = {
    "balanced":    {"zoning": .17, "adjacency": .18, "circulation": .10, "proportion": .16,
                    "daylight": .12, "service": .08, "privacy": .07, "vastu": .12},
    "vastu":       {"zoning": .10, "adjacency": .10, "circulation": .08, "proportion": .12,
                    "daylight": .10, "service": .06, "privacy": .06, "vastu": .38},
    "light_air":   {"zoning": .10, "adjacency": .12, "circulation": .08, "proportion": .16,
                    "daylight": .32, "service": .06, "privacy": .08, "vastu": .08},
    "compact":     {"zoning": .10, "adjacency": .26, "circulation": .22, "proportion": .12,
                    "daylight": .08, "service": .12, "privacy": .05, "vastu": .05},
}
PROFILE_LABEL = {
    "balanced": "balanced_zoning", "vastu": "vastu_aligned",
    "light_air": "light_and_ventilation", "compact": "compact_circulation",
}


# --------------------------------------------------------------------------------
# Program preparation
# --------------------------------------------------------------------------------
UPPER_GROW = 1.35


def _add_fillers(program: Program, F: float, D: float) -> None:
    """Nothing is ever added to the brief: no lounge, dining room, utility or terrace the user did not ask for.

    The floors share one footprint.  An upper floor whose own rooms (at their largest sensible sizes) cannot fill it leaves the rest of the
    footprint as the open roof of the floor below -- a plain flat roof.  The engine models that region as an `open_terrace` cell so that the
    floor still tiles the footprint; `adapter.plan_to_legacy` publishes it as a roof area, not as a room, with no door or access."""
    for fp in program.floors:
        if fp.index == 0:
            continue                      # the ground floor is the footprint: its rooms must fill it
        specs = fp.all_specs()
        # the rooms first grow towards their practical largest size; only what they still cannot fill is left as open roof
        cap = sum(s.target if s.type == "staircase" else min(s.rule.max_a * 0.85, s.target * UPPER_GROW) for s in specs)
        deficit = F * D - cap / 0.92
        if deficit > 110:
            fp.specs.append(RoomSpec(f"open_terrace_f{fp.index}", "open_terrace", "Flat Roof", fp.index, deficit * 0.95))


def _rebalance(program: Program, cap: float) -> None:
    """Move a bedroom (with its bath) downstairs when an upper floor is over-full."""
    def need(fp):
        return sum(x.target for x in fp.all_specs() if x.type != "open_terrace") / 0.9
    for _ in range(3):
        over = [fp for fp in program.floors[1:] if need(fp) > cap * 0.84]
        if not over or need(program.floors[0]) > cap * 0.6:
            return
        fp = over[0]
        beds = [x for x in fp.specs if x.type == "bedroom"]
        if not beds:
            return
        b = beds[-1]
        group = [b] + [x for x in fp.specs if x.type == "bathroom" and x.attached_to == b.id]
        for g in group:
            fp.specs.remove(g)
            g.floor = 0
            program.floors[0].specs.append(g)
        program.warnings.append(f"{b.name} is planned on the ground floor because the upper floor is full.")


def _ground_depth(program: Program, F: float, D: float) -> float:
    """Shrink the footprint depth when the rooms cannot cover the plot (the rest becomes garden)."""
    cap = sum(s.rule.max_a * 0.85 for s in program.floors[0].all_specs())
    if cap >= F * D:
        return D
    depth = snap_down(cap / F, 1.0)
    return max(min(D, depth), 12.0)


# --------------------------------------------------------------------------------
# Pins (staircase position)
# --------------------------------------------------------------------------------
def _pin_candidates(rng: random.Random, A: float, B: float, dims: Tuple[float, float],
                    front_free: float = 0.0) -> Pin:
    s, l = dims
    for _ in range(40):
        wa, db = (s, l) if (not front_free or rng.random() < 0.4 or A - l < 11.0) else (l, s)
        if wa > A - 3 or db > B - 3:
            continue
        a0 = rng.choice([0.0, A - wa, snap_down(rng.uniform(0, A - wa), GRID)])
        side_l, side_r = a0, A - a0 - wa
        if (0.1 < side_l < 6.0) or (0.1 < side_r < 6.0):
            continue
        fr_opts = [0.0] + [x * GRID for x in range(int(max(8.0, front_free) / GRID), int((B - db) / GRID) + 1)]
        if front_free:                        # the front band must be deep enough for the vehicles
            fr_opts = [x for x in fr_opts if x < 0.1 or (x <= 17.5 and x >= front_free) or x / 2 >= front_free]
        if not fr_opts:
            continue
        b0 = rng.choice(fr_opts)
        rr = B - b0 - db
        def _ok(x):
            return x < 0.1 or 8.5 <= x <= 17.5 or 21.0 <= x <= 29.0
        if not (_ok(b0) and _ok(rr)):
            continue
        return Pin(a0, wa, b0, db)
    return None


# --------------------------------------------------------------------------------
# Floor generation
# --------------------------------------------------------------------------------
def _cfgs(A: float, B: float, has_beds: bool) -> List[Tuple[int, Optional[int]]]:
    out = []
    for nb in (1, 2, 3, 4):
        depth = B / nb
        if 7.5 <= depth <= 16.5:
            out.append((nb, None))
            if nb >= 2 and has_beds:
                out += [(nb, k) for k in range(1, nb)]
    if not out:
        out.append((max(1, round(B / 11)), None))
    return out


def _gen_floor(rng: random.Random, fp: FloorProgram, floor: int, nfloors: int, F: float, D: float,
               family: str, pin: Optional[Pin], tries: int, targets: Dict[str, float],
               deadline: float, want: int = 0) -> List[FloorSol]:
    A, B = (F, D) if family == "rows" else (D, F)
    has_beds = any(s.type in BEDROOM_TYPES for s in fp.specs)
    cfgs = _cfgs(A, B, has_beds)
    # A corridor band is one passage as long as the band (A).  While the passage cap is on (strict mode) such a passage
    # is rejected by hard_check whenever A > 16 ft, so building and realising it is pure waste: skip those structures.
    no_corridor = bool(STRICT["on"] and STRICT.get("pass_cap", True) and A > 16.0)
    if no_corridor:
        cfgs = [c for c in cfgs if c[1] is None] or cfgs
    root = "living_room" if floor == 0 else "staircase"
    if floor == 0 and not any(s.id == "living_room" for s in fp.specs):
        root = fp.specs[0].id
    out: List[FloorSol] = []
    for _ in range(tries):
        if time.time() > deadline:
            break
        nb, cor = rng.choice(cfgs)
        if pin is not None:
            cor = None if no_corridor else rng.choice([None, 1, 2, 1, 2])
        pp = rng.choice([0.15, 0.4])
        if floor > 0 and has_beds and sum(1 for x in fp.specs if x.type in BEDROOM_TYPES) >= 2:
            pp = 0.7                       # a bedroom floor needs one lobby/passage beside the stair
            if pin is None and not no_corridor and rng.random() < 0.6:
                with_cor = [c for c in cfgs if c[1] is not None]      # circulation: favour structures with an enclosed corridor
                if with_cor:
                    nb, cor = rng.choice(with_cor)
            elif pin is not None and not no_corridor and pin.db >= pin.wa and rng.random() < 0.7:
                # a dog-leg stair is entered at its low end (its high end when the low end is on the building edge): the corridor that
                # serves the bedrooms must be on that side, or the stair would arrive in front of a room instead of a landing
                cor = 2 if pin.b0 < 0.5 else 1
        st = build_struct(rng, fp.specs, fp.stair if pin else None, floor, family, A, B, pin, nb, cor,
                          True, rng.choice([0.06, 0.12, 0.2]), rng.choice([0.2, 0.4]), pp)
        if st is None:
            continue
        r = realise(st, floor)
        if r is None:
            continue
        rooms, cost = r
        ev = evaluate_floor(rooms, F, D, floor, nfloors, root, None, targets)
        if ev.ok:
            out.append(FloorSol(rooms, ev, cost, family))
            if want and len(out) >= want:
                break                  # only the best 8 per floor are kept: enough candidates found, stop spending time on this floor
    return out


# --------------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------------
def _mapper(site: Site, F: float, D: float, yard: float, u_off: float):
    W, L = site.plot_w, site.plot_l

    def m(r: Room):
        u = r.u
        x, y, w, l = site.rect_to_real(site.left + u_off + u, site.front + yard + r.v, r.w, r.d)
        return x + w / 2, y + l / 2, W, L
    return m


def _plan_feats(floors: Sequence[FloorSol]) -> Dict[str, float]:
    keys = floors[0].ev.features.keys()
    # the ground floor and the floor with most rooms carry more weight
    wts = [1.4 if i == 0 else 1.0 for i in range(len(floors))]
    return {k: sum(w * f.ev.features[k] for w, f in zip(wts, floors)) / sum(wts) for k in keys}


def _stack_bonus(floors: Sequence[FloorSol]) -> float:
    """Share of wet rooms that have a wet room in the same place on the floor below."""
    if len(floors) < 2:
        return 1.0
    hit = tot = 0
    for lo, up in zip(floors[:-1], floors[1:]):
        wet_lo = [r for r in lo.rooms if r.type in ("bathroom", "toilet", "kitchen", "utility")]
        for r in up.rooms:
            if r.type not in ("bathroom", "toilet"):
                continue
            tot += 1
            if any(min(r.u2, w.u2) - max(r.u, w.u) > 1.5 and min(r.v2, w.v2) - max(r.v, w.v) > 1.5
                   for w in wet_lo):
                hit += 1
    return hit / tot if tot else 1.0


def _profile_score(plan: PlanSol, profile: str) -> float:
    w = PROFILES[profile]
    f = dict(plan.feats)
    f["vastu"] = plan.vastu
    tot = sum(r.w * r.d for fl in plan.floors for r in fl.rooms) or 1.0
    pas = sum(r.w * r.d for fl in plan.floors for r in fl.rooms if r.type == "passage")
    return sum(w[k] * f[k] for k in w) + 0.35 * f.get("coverage", 1.0) - 4.0 * pas / tot    # bigger footprints win; passages cost


# --------------------------------------------------------------------------------
# Public entry
# --------------------------------------------------------------------------------
def _mirror_rooms(rooms: List[Room], F: float) -> List[Room]:
    return [Room(r.id, r.type, r.name, r.floor, F - r.u - r.w, r.v, r.w, r.d, r.attached_to, r.role)
            for r in rooms]


def _similar(a: PlanSol, b: PlanSol) -> float:
    """Mean displacement of same-id rooms on the ground floor, as a share of the footprint."""
    ra = {r.id: r for r in a.floors[0].rooms}
    rb = {r.id: r for r in b.floors[0].rooms}
    tot = n = 0.0
    for k, x in ra.items():
        y = rb.get(k)
        if y is None:
            continue
        ua = x.cu
        ub = y.cu
        tot += abs(ua - ub) / a.F + abs(x.cv - y.cv) / max(a.D, b.D)
        n += 1
    return tot / n if n else 1.0


def search(payload: Dict[str, Any], budget_s: float = 10.0, seed: Optional[int] = None,
           want: int = 4, give_up: float = 0.0) -> Dict[str, Any]:
    t0 = time.time()
    rng = random.Random(seed if seed is not None else 12345)
    site, program = _site_and_program(payload)
    report = analyse(site, program)
    if program.errors or report["status"] == "infeasible":
        return {"ok": False, "feasibility": report, "program": program, "plans": []}
    box = available_box(site)
    F = snap_down(box["frontage"], GRID)
    D = snap_down(box["depth"], GRID)
    F0, Dbox = F, D
    _rebalance(program, F0 * Dbox)
    import copy
    base_program = program
    nfl = len(program.floors)
    if payload.get("_algo") == "strip":
        from backend.planner.architect.strip import search_strip
        return search_strip(payload, budget_s, seed, want, program, site, box, F0, Dbox, give_up)
    # footprints worth trying: the building need not cover the whole plot
    H = max(sum(sp.target for sp in fp.all_specs() if sp.type != "open_terrace")
            for fp in program.floors) / 0.9
    foots: List[Tuple[float, float]] = []
    # every floor shares one footprint, so it cannot be bigger than the roomiest the smallest floor can fill
    # (upper floors absorb any extra area as open terrace, so only the ground floor limits the footprint)
    cap_area = sum(sp.rule.max_a * 0.9 for sp in program.floors[0].all_specs() if sp.type != "open_terrace")
    porch = bool(site.cars or site.bikes)
    # a car porch needs its own width plus a hall, a stair and a room beside it, but the building does NOT have to use the whole frontage:
    # a narrower, deeper footprint is often the one that lets every upper floor be laid out without stretching its rooms
    from backend.planner.architect.rules import park_width
    porch_w = max((park_width(s_.type, s_.role) for s_ in program.floors[0].specs if s_.type in ("parking", "bike_parking")), default=0.0)
    f_floor = max(14.0, snap_down(porch_w + (program.stair_dims[0] if program.stair_dims else 0.0) + 12.0, GRID)) if porch else 14.0
    for fac in (1.05, 1.2, 1.4, 1.7, 2.0):
        for asp in (0.9, 1.15, 1.45):
            area = min(H * fac, cap_area)
            f_norm = min(F0, snap_down(math.sqrt(area * asp), GRID))
            for f in ([F0, min(F0, max(f_norm, f_floor))] if porch else [f_norm]):    # porch: the full-frontage footprint first, then the narrower one
                d = snap_down(area / f, GRID)
                if porch:
                    d = max(d, min(Dbox, 28.0))
                if d > Dbox:
                    d = Dbox
                    f = min(F0, snap_down(area / d, GRID))
                if f >= 14 and d >= 12 and (f, d) not in foots:
                    foots.append((f, d))
    if (F0 * Dbox <= H * 1.7 and not F0 * Dbox > cap_area * 1.15) or not foots:
        foots.append((F0, Dbox))
    # rooms have a largest comfortable size: do not try footprints they cannot fill
    small = [x for x in foots if x[0] * x[1] <= cap_area * 1.15]
    foots = small or [min(foots, key=lambda x: x[0] * x[1])]
    D0 = foots[-1][1]
    targets: Dict[str, float] = {}
    mode = payload.get("vastu_mode", "no_preference")

    pool: List[PlanSol] = []
    deadline = t0 + budget_s
    rounds = 0
    good: List[Tuple[float, float, str, Any]] = []
    probe_n = [0] * nfl
    probe_ok = [0] * nfl
    stats = {"rounds": 0, "floors_ok": 0}
    while time.time() < deadline and len(pool) < 80:
        # enough distinct, verified-shape candidates: more rounds only add near-duplicates (pick_four needs 4 different ones)
        if len(pool) >= 24 and len(good) >= 2:
            break
        if len(pool) >= 12 and len(good) >= 2 and time.time() - t0 > budget_s * 0.35:
            break
        # give up early when nothing at all works for this brief (the caller will relax it)
        if give_up and not pool and stats["floors_ok"] == 0 and time.time() - t0 > budget_s * give_up:
            break
        rounds += 1
        if STRICT["on"] and not STRICT["passage_ok"] and stats["floors_ok"] == 0 and time.time() - t0 > budget_s * 0.4:
            STRICT["passage_ok"] = True
            stats["passage_needed"] = 1
        if STRICT["on"] and STRICT["util_corner"] and stats["floors_ok"] == 0 and time.time() - t0 > budget_s * 0.2:
            STRICT["util_corner"] = False              # utility on an outer wall, not necessarily a corner
            stats["util_not_corner"] = 1
        if STRICT["on"] and stats["floors_ok"] == 0 and STRICT["max_pass"] < 4 and time.time() - t0 > budget_s * 0.4:
            STRICT["max_pass"] = 4                     # a bigger house may need a second hall
            stats["more_passages"] = 1
        if STRICT["on"] and stats["floors_ok"] == 0 and STRICT["aspect"] < 1.4 and time.time() - t0 > budget_s * 0.55:
            from backend.planner.architect.rules import set_aspect
            set_aspect(1.4)                            # last resort: some rooms up to 1:1.4
            stats["aspect_wide"] = 1
        if STRICT["on"] and STRICT.get("pass_cap", True) and stats["floors_ok"] == 0 and time.time() - t0 > budget_s * 0.45 and not STRICT.get("pass_cap_hold"):
            STRICT["pass_cap"] = False                 # a longer passage only when nothing else fits (never labelled)
            stats["long_passage"] = 1
        if STRICT["on"] and STRICT["bath_ext"] and stats["floors_ok"] == 0 and time.time() - t0 > budget_s * 0.3:
            STRICT["bath_ext"] = False                 # last resort: a bath may sit inside, served by its duct
            stats["bath_inside"] = 1
        round_end = min(deadline, time.time() + max(3.0, budget_s / 3))
        reuse = good and rng.random() < 0.7
        if reuse:
            F, D, family, pin = rng.choice(good)
        else:
            F, D = foots[-1] if rng.random() < 0.3 else rng.choice(foots)
            family = rng.choice(["rows", "rows", "cols"])
            if site.cars or site.bikes:
                family = "rows"                  # the porch needs a front band across the road frontage
            pin = None
        u_off = snap_down((F0 - F) / 2, GRID)
        program = copy.deepcopy(base_program)
        _add_fillers(program, F, D)
        targets = {s_.id: s_.target for fp in program.floors for s_ in fp.all_specs()}
        if nfl > 1 and not reuse:
            A, B = (F, D) if family == "rows" else (D, F)
            pin = _pin_candidates(rng, A, B, program.stair_dims, (15.0 if site.cars else 8.0) if (site.cars or site.bikes) else 0.0)
            if pin is None:
                continue
            # cheap screen: a pin is only worth probing if every floor can be structured around it
            screened = True
            for fi_, fp_ in (enumerate(program.floors) if STRICT.get('prescreen') else []):
                hb = any(x.type in BEDROOM_TYPES for x in fp_.specs)
                okc = 0
                for _t in range(40):
                    nb_, cor_ = rng.choice(_cfgs(A, B, hb))
                    if build_struct(rng, fp_.specs, fp_.stair, fi_, family, A, B, pin, nb_,
                                    rng.choice([None, 1, 2]), True, 0.1, 0.3, 0.4) is not None:
                        okc += 1
                        break
                if not okc:
                    screened = False
                    break
            if not screened:
                continue
        per_floor: List[List[FloorSol]] = []
        ok = True
        quick = 140 if nfl > 1 else 700
        # hardest floor first (cheap probe): by bedrooms to begin with, then by how rarely a pin has worked for that floor so far
        order = sorted(range(nfl), key=lambda i: ((probe_ok[i] + 0.5) / (probe_n[i] + 3.0),
                                                  -sum(1 for x in program.floors[i].specs if x.type in BEDROOM_TYPES)))
        found: Dict[int, List[FloorSol]] = {}
        for fi in order:                              # hardest floors first, cheap probe
            fp = program.floors[fi]
            if nfl > 1:
                probe = _gen_floor(rng, fp, fi, nfl, F, D, family, pin, 30, targets, round_end)
                probe_n[fi] += 1
                probe_ok[fi] += 1 if probe else 0
                if not probe:                         # staged probe: a pin that gives nothing in 30 tries is not worth 90
                    ok = False
                    break
                probe += _gen_floor(rng, fp, fi, nfl, F, D, family, pin, 60, targets, round_end)
                found[fi] = probe + _gen_floor(rng, fp, fi, nfl, F, D, family, pin, quick, targets, round_end, want=20)
            else:
                found[fi] = _gen_floor(rng, fp, fi, nfl, F, D, family, pin, quick, targets, round_end)
                if not found[fi]:
                    ok = False
        if not ok:
            continue
        per_floor = [found[i] for i in range(nfl)]
        if nfl > 1:                                   # this pin works: enrich every floor
            for fi, fp in enumerate(program.floors):
                per_floor[fi] += _gen_floor(rng, fp, fi, nfl, F, D, family, pin, 500, targets, round_end, want=20)
        for cands in per_floor:
            cands.sort(key=lambda c: sum(c.ev.features.values()) - 0.002 * c.cost, reverse=True)
        per_floor = [c[:8] for c in per_floor]
        stats["floors_ok"] += 1
        stats.setdefault("first_ok_s", round(time.time() - t0, 2))
        if not reuse:
            good.append((F, D, family, pin))
        for k in range(min(len(c) for c in per_floor)):
            floors = [pf[k] for pf in per_floor]
            for mirror in (False, True):
                fl = floors
                if mirror:
                    fl = []
                    for fi_, f in enumerate(floors):
                        mr = _mirror_rooms(f.rooms, F)
                        root_ = "living_room" if fi_ == 0 and any(x.id == "living_room" for x in mr) \
                            else ("staircase" if fi_ > 0 else mr[0].id)
                        ev_ = evaluate_floor(mr, F, D, fi_, nfl, root_, None, targets)
                        if not ev_.ok:
                            fl = None
                            break
                        fl.append(FloorSol(mr, ev_, f.cost, f.family))
                    if fl is None:
                        continue
                mp = _mapper(site, F, D, box["yard_depth"], u_off)
                vs = [vastu_score(f.rooms, mp, mode) for f in fl]
                feats = _plan_feats(fl)
                feats["service"] = 0.6 * feats["service"] + 0.4 * _stack_bonus(fl)
                feats["coverage"] = min(1.0, (F * D) / max(1.0, F0 * Dbox))
                ps = PlanSol(fl, F, D, family, pin, mirror, feats, sum(vs) / len(vs))
                ps.u_off = u_off
                ps.program = program
                pool.append(ps)
    for p_ in pool:
        p_.score = _profile_score(p_, "balanced")
    stats["rounds"] = rounds
    stats["probe"] = [probe_n[:], probe_ok[:]]
    return {"ok": True, "feasibility": report, "program": base_program, "plans": pool, "site": site,
            "F": F, "D": D0, "yard": box["yard_depth"], "rounds": rounds, "stats": stats,
            "elapsed": time.time() - t0}


def pick_four(pool: List[PlanSol], want: int = 4) -> List[PlanSol]:
    chosen: List[PlanSol] = []
    profiles = ["balanced", "vastu", "light_air", "compact"]
    for thr in (0.14, 0.09, 0.05, 0.0):
        for prof in profiles:
            if len(chosen) >= want:
                break
            if any(p.label == PROFILE_LABEL[prof] for p in chosen):
                continue
            ranked = sorted(pool, key=lambda p: _profile_score(p, prof), reverse=True)
            for cand in ranked:
                if cand in chosen:
                    continue
                if all(_similar(cand, c) >= thr for c in chosen):
                    cand.label = PROFILE_LABEL[prof]
                    chosen.append(cand)
                    break
    return chosen
