"""A second, constructive layout algorithm: a single-loaded spine corridor.

The band engine (layout.py / engine.py) builds a house out of full-width bands.  On a long, shallow buildable strip (a 24 x 50 ft plot with its
road on the long side leaves about 44 x 16 ft) or on a very small footprint it often cannot structure a floor at all.  This module builds the floor
directly instead, so that circulation is right by construction:

    v = 0 (road)   [ strip cells ][ row rooms ............ ][ porch (ground floor) ]
                   [ staircase   ][ spine corridor (passage) ......................]  v = D
                    u = 0

* the staircase sits at one end, at the rear, so that its entry end opens straight onto the spine (the arrival landing);
* every room of the row touches the spine, so every room is entered from the corridor and none is a thoroughfare;
* the cells in front of the stair (the "strip") are rooms that may be entered from a neighbouring common room (kitchen <- dining) or an open
  terrace that is entered from a bedroom / the lounge;
* a car porch is an end block that touches the road and is as wide as its vehicles;
* every floor shares one footprint and one staircase position.

Everything built here goes through the same evaluate_floor / door planner / independent verifier / circulation validator as the band engine's
output, so it can only be returned if it passes all of them.
"""

from __future__ import annotations

import math
import random
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

from backend.planner.architect.geometry import Room
from backend.planner.architect.rules import (
    BEDROOM_TYPES, GRID, PARK_MIN_DEPTH, PARKING_TYPES, STRICT, _COMPACT, park_width, room_ok, rule_for,
)
from backend.planner.architect.site import snap_down

SPINE = 4.0                      # depth of the corridor: the stair's end door (3 ft + margins) must fit on the shared wall

DBG: Dict[int, int] = {}


def _no(k: int):
    DBG[k] = DBG.get(k, 0) + 1
    return None


_WCACHE: Dict[Tuple, List[float]] = {}


def widths(rtype: str, depth: float) -> List[float]:
    """Every width (0.5 ft grid) a room of this type may have when it is `depth` deep."""
    key = (rtype, depth, _COMPACT["f"], STRICT.get("aspect"))
    got = _WCACHE.get(key)
    if got is None:
        rule = rule_for(rtype)
        got = []
        w = 3.0
        while w <= 60.0:
            if room_ok(rule, w, depth):
                got.append(w)
            w += GRID
        if len(_WCACHE) > 4000:
            _WCACHE.clear()
        _WCACHE[key] = got
    return got


def _split(lists: List[List[float]], total: float, rng: random.Random) -> Optional[List[float]]:
    """One width from each list so that they add up to `total` (random choice among the solutions)."""
    sols: List[List[float]] = []

    def rec(i: int, left: float, acc: List[float]) -> None:
        if len(sols) >= 40:
            return
        if i == len(lists):
            if abs(left) < 1e-6:
                sols.append(list(acc))
            return
        rest_min = sum(min(l) for l in lists[i + 1:])
        rest_max = sum(max(l) for l in lists[i + 1:])
        for w in lists[i]:
            if left - w < rest_min - 1e-6 or left - w > rest_max + 1e-6:
                continue
            acc.append(w)
            rec(i + 1, left - w, acc)
            acc.pop()

    rec(0, total, [])
    return rng.choice(sols) if sols else None


def _clamp_to(vals: List[float], x: float) -> float:
    return min(vals, key=lambda v: abs(v - x))


def _atoms(specs, rng: random.Random) -> List[List[Any]]:
    """Specs grouped so that rooms which must touch each other stay together."""
    used = set()
    out: List[List[Any]] = []
    beds = [s for s in specs if s.type in BEDROOM_TYPES]
    for b in beds:
        baths = [x for x in specs if x.type == "bathroom" and x.attached_to == b.id]
        used.add(b.id)
        used.update(x.id for x in baths)
        if len(baths) == 1:
            out.append([baths[0], b] if rng.random() < 0.5 else [b, baths[0]])
        elif len(baths) >= 2:
            out.append([baths[0], b] + baths[1:])
        else:
            out.append([b])
    by_type = {}
    for s in specs:
        if s.id not in used:
            by_type.setdefault(s.type, []).append(s)
    k = by_type.pop("kitchen", [])
    u = by_type.pop("utility", [])
    d = by_type.pop("dining", [])
    if k:
        chain = [k[0]]
        if u:
            chain.append(u.pop(0))
        if d:
            chain.insert(0, d.pop(0))
        if rng.random() < 0.5:
            chain.reverse()
        out.append(chain)
        k = k[1:]
    for lst in (k, u, d):
        out.extend([x] for x in lst)
    t = by_type.pop("toilet", [])
    cb = [x for x in by_type.get("bathroom", [])]
    if t and cb:
        out.append([cb.pop(0), t.pop(0)])
        by_type["bathroom"] = cb
    for lst in by_type.values():
        out.extend([x] for x in lst)
    out.extend([x] for x in t)
    rng.shuffle(out)
    return out


def _spread(cells: List[Tuple[Any, List[float], float]], total: float) -> Optional[List[float]]:
    """Pick one width per cell from its allowed list so that they sum to `total` (0.5 grid), staying near each cell's target width."""
    ws = [_clamp_to(vals, tgt) for _, vals, tgt in cells]
    lo = [min(v) for _, v, _ in cells]
    hi = [max(v) for _, v, _ in cells]
    if sum(lo) > total + 1e-6 or sum(hi) < total - 1e-6:
        DBG.setdefault("spread", []).append((round(sum(lo), 1), round(sum(hi), 1), total, [c.type for c, _, _ in cells])) if len(DBG.get("spread", [])) < 12 else None
        return None
    guard = 0
    while abs(sum(ws) - total) > 1e-6 and guard < 400:
        guard += 1
        diff = total - sum(ws)
        step = GRID if diff > 0 else -GRID
        # the cell furthest from its target on the side we need to move gets the step
        order = sorted(range(len(ws)), key=lambda i: (ws[i] - cells[i][2]) * (1 if step < 0 else -1))
        moved = False
        for i in order:
            nw = ws[i] + step
            if nw in cells[i][1] or any(abs(nw - v) < 1e-6 for v in cells[i][1]):
                ws[i] = nw
                moved = True
                break
        if not moved:
            return None
    return ws if abs(sum(ws) - total) <= 1e-6 else None


def _order_strip(pick: List[Any], left: List[Any]) -> Optional[List[Any]]:
    """Left-to-right order of the strip cells that keeps the utility in the front corner, beside the kitchen, and the kitchen beside the dining room."""
    rank = {"utility": 0, "kitchen": 1, "dining": 2}
    out = sorted(pick, key=lambda c: rank.get(c.type, 3))
    types = [c.type for c in out]
    if "utility" in types:
        if types[0] != "utility":
            return None
        if "kitchen" in types:
            if types[1] != "kitchen":
                return None
        elif any(c.type == "kitchen" for c in left) and len(types) > 1:
            return None
    if "kitchen" in types:
        i = types.index("kitchen")
        if "dining" in types:
            if types[i + 1:i + 2] != ["dining"]:
                return None
        elif any(c.type == "dining" for c in left) and i != len(types) - 1:
            return None
    return out


def _build_floor(rng: random.Random, fp, floor: int, par: Dict[str, float], mirror_ok: bool = True) -> Optional[List[Room]]:
    """One candidate floor for the shared parameters `par` (D, Ls, db, Wrow, porch width pw)."""
    from backend.planner.architect.program import RoomSpec
    D, Ls, db, Wrow, pw = par["D"], par["Ls"], par["db"], par["Wrow"], par["pw"]
    s = SPINE
    Df = D - db                      # depth of the cells in front of the stair
    Dr = D - s                       # depth of the row rooms
    ground = floor == 0
    specs = [x for x in fp.specs if x.type not in PARKING_TYPES]
    porch = [x for x in fp.specs if x.type in PARKING_TYPES]
    if porch and not ground:
        porch = []
    atoms = _atoms(specs, rng)
    seq = [c for a in atoms for c in a]

    # ---- the strip in front of the stair: one or two cells whose widths add up to the stair block's width -----------------------------
    def eligible(c):
        return bool(widths(c.type, Df))
    strip: List[Any] = []
    # rooms too shallow-limited for the row (a utility cannot be 12 ft deep) must go in the strip
    forced = [c for c in seq if not widths(c.type, Dr)]
    if any(not eligible(c) for c in forced) or len(forced) > 2:
        return _no(3)
    if ground or forced or any(c.type in ("study", "utility", "puja_room") for c in seq) and rng.random() < 0.3:
        cand = [c for c in seq if c not in forced and eligible(c) and c.type not in BEDROOM_TYPES and not (c.type == "bathroom" and c.attached_to)]
        Wchk = Wrow + (0.0 if ground else pw)
        for _try in range(8):
            rng.shuffle(cand)
            n = rng.choice([1, 2, 2, 3, 3] if ground else [1, 2])
            if len(cand) + len(forced) < n or len(forced) > n:
                continue
            pick = forced + cand[:n - len(forced)]
            left = [c for c in seq if c not in pick]
            if ground:                                  # the row must be able to take what is left
                lo = sum(min(widths(c.type, Dr) or [99.0]) for c in left)
                hi = sum(max(widths(c.type, Dr) or [0.0]) for c in left)
                if lo > Wchk + 1e-6 or hi < Wchk - 1e-6:
                    continue
            ordered = _order_strip(pick, left)
            if ordered is None:
                continue
            sw0 = _split([widths(c.type, Df) for c in ordered], Ls, rng)
            if sw0 is not None:
                strip = ordered
                partner_front = ordered[-1] if ordered else None
                break
        if strip:
            # the strip cell on the row side hands over to its partner, which opens the row (utility -> kitchen, kitchen -> dining)
            want_t = {"utility": "kitchen", "kitchen": "dining"}.get(strip[-1].type, "living_room")
            front = [c for c in seq if c not in strip and c.type == want_t]
            if front:
                seq = [front[0]] + [c for c in seq if c is not front[0]]
    if not strip and ground:
        # the brief's own rooms cannot fill the space beside the stair: only a foyer (circulation, not a room) may take it -- never a lounge or
        # study the user did not ask for
        opts = [("passage",)]
        for ts_ in opts:
            lists = [widths(t_, Df) for t_ in ts_]
            if any(not l_ for l_ in lists):
                continue
            sw1 = _split(lists, Ls, rng)
            if sw1 is None:
                continue
            nm = {"family_lounge": "Family Lounge", "study": "Study", "passage": "Foyer"}
            strip = [RoomSpec(f"{t_}_strip{k}", t_, nm[t_], floor, Ls * Df / len(ts_)) for k, t_ in enumerate(ts_)]
            break
        if strip and any(c.type in BEDROOM_TYPES for c in strip):
            strip = []
        if strip:
            front = [c for c in seq if c.type == "living_room"]
            if front:
                seq = [front[0]] + [c for c in seq if c is not front[0]]
    if not strip:
        if ground:
            return _no(1)
        ter = RoomSpec(f"open_terrace_f{floor}", "open_terrace", "Flat Roof", floor, Ls * Df)
        if not widths("open_terrace", Df) or Ls not in widths("open_terrace", Df):
            return _no(2)
        strip = [ter]
    rest = [c for c in seq if c not in strip]

    # ---- the row ------------------------------------------------------------------------------------------------------------------------
    W = Wrow + (0.0 if ground else pw)
    cells = [(c, widths(c.type, Dr), max(c.target / Dr, 3.0)) for c in rest]
    if any(not v for _, v, _ in cells):
        return _no(3)
    fillers: List[Any] = []
    if not ground:
        have_lounge = any(c.type == "family_lounge" for c in rest)
        slack = W - sum(min(v) for _, v, _ in cells)
        room_left = W - sum(max(v) for _, v, _ in cells)
        if room_left > 1e-6:                          # the rooms cannot fill the row: the rest is the flat roof of the floor below (no invented room)
            if room_left > 1e-6:
                tw = widths("open_terrace", Dr)
                if not tw:
                    return _no(4)
                ter = RoomSpec(f"open_terrace_row_f{floor}", "open_terrace", "Flat Roof", floor, 150.0)
                fillers.append(ter)
                cells.append((ter, tw, max(8.0, room_left)))
        elif slack < -1e-6:
            return _no(5)
    rng.shuffle(cells) if False else None
    ws = _spread(cells, W)
    if ws is None:
        return _no(6)
    # a terrace (leaf) goes at an end of the row, away from the stair block, so that it has an outer wall on two sides
    order = list(range(len(cells)))
    for i in list(order):
        if cells[i][0].type == "open_terrace" and cells[i][0] in fillers:
            order.remove(i)
            order.append(i)

    rooms: List[Room] = []
    # stair block
    stair_spec = fp.stair
    rooms.append(Room("staircase", "staircase", "Staircase", floor, 0.0, D - db, Ls, db, None, stair_spec.role if stair_spec else ""))
    # strip cells
    sw = _split([widths(c.type, Df) for c in strip], Ls, rng)
    if sw is None:
        return _no(7)
    u = 0.0
    for c, w in zip(strip, sw):
        rooms.append(Room(c.id, c.type, c.name, floor, u, 0.0, w, Df, c.attached_to, c.role))
        u += w
    # the row
    u = Ls
    for i in order:
        c, _, _ = cells[i]
        w = ws[i]
        rooms.append(Room(c.id, c.type, c.name, floor, u, 0.0, w, Dr, c.attached_to, c.role))
        u += w
    # spine
    rooms.append(Room(f"corridor_{floor}", "passage", "Passage", floor, Ls, Dr, u - Ls, s))
    # porch
    if porch and ground:
        p = porch[0]
        rooms.append(Room(p.id, p.type, p.name, floor, u, 0.0, pw, D, p.attached_to, p.role))
    return rooms


def search_strip(payload: Dict[str, Any], budget_s: float, seed: Optional[int], want: int, program, site, box, F0: float, Dbox: float,
                 give_up: float = 0.0) -> Dict[str, Any]:
    """Same result shape as engine.search; plans carry family 'strip'."""
    from backend.planner.architect import engine as E
    t0 = time.time()
    rng = random.Random((seed if seed is not None else 12345) + 77)
    nfl = len(program.floors)
    base_program = program
    mode = payload.get("vastu_mode", "no_preference")
    stats = {"rounds": 0, "floors_ok": 0, "algorithm": "strip"}
    pool: List[Any] = []
    deadline = t0 + budget_s
    saved = {k: STRICT.get(k) for k in ("pass_cap", "max_pass", "passage_ok")}
    STRICT.update({"pass_cap": False, "max_pass": max(STRICT.get("max_pass", 2), 4), "passage_ok": True})    # the spine is one long passage by design
    from backend.planner.architect.rules import set_aspect
    old_aspect = STRICT.get("aspect", 1.25)
    asp = float(payload.get("_strip_aspect", 1.6))
    if asp > old_aspect:
        set_aspect(asp)                    # a long shallow strip cannot make near-square rooms (a Tier-3 shape preference, not a code minimum)
    try:
        stair_dims = program.stair_dims or (0.0, 0.0)
        db, Ls = stair_dims if nfl > 1 else (0.0, 0.0)
        have_stair = nfl > 1
        cars_spec = [x for x in program.floors[0].specs if x.type in PARKING_TYPES]
        pw = park_width(cars_spec[0].type, cars_spec[0].role) if cars_spec else 0.0
        pdepth = PARK_MIN_DEPTH[cars_spec[0].type] if cars_spec else 0.0
        dmax = min(Dbox, 22.0)
        if have_stair:
            dmin = max(db + 7.0, SPINE + 8.0)
        else:
            dmin = SPINE + 8.0
        D_choices = [d_ for d_ in [dmin + GRID * k for k in range(int((dmax - dmin) / GRID) + 1)] if d_ <= dmax + 1e-6]
        if cars_spec:
            D_choices = [d_ for d_ in D_choices if d_ >= pdepth - 1e-6]
        if not D_choices:
            stats["why"] = "buildable depth too small for the spine layout"
            return {"ok": True, "feasibility": E.analyse(site, program), "program": base_program, "plans": [], "site": site, "F": F0, "D": dmax,
                    "yard": box["yard_depth"], "rounds": 0, "stats": stats, "elapsed": time.time() - t0}
        while time.time() < deadline and len(pool) < 60:
            if give_up and not pool and (time.time() - t0 > budget_s * give_up or (stats["rounds"] > 120 and not stats["floors_ok"])):
                break
            stats["rounds"] += 1
            D = rng.choice(D_choices[-6:]) if rng.random() < 0.7 else rng.choice(D_choices)
            if have_stair and D - db < 5.0:
                continue
            Wmax = snap_down(F0 - Ls - pw, GRID)
            if Wmax < 8.0:
                continue
            Wrow = snap_down(rng.uniform(max(8.0, Wmax * 0.55), Wmax), GRID) if rng.random() < 0.85 else Wmax
            par = {"D": D, "Ls": Ls, "db": db, "Wrow": Wrow, "pw": pw}
            F = Ls + Wrow + pw
            program_i = base_program
            targets = {s_.id: s_.target for fp in program_i.floors for s_ in fp.all_specs()}
            per_floor: List[List[Any]] = []
            ok = True
            for fi, fp in enumerate(program_i.floors):
                found: List[Any] = []
                for _t in range(60 if fi == 0 else 90):
                    rooms = _build_floor(rng, fp, fi, par)
                    if rooms is None:
                        continue
                    root = "living_room" if fi == 0 else "staircase"
                    if fi == 0 and not any(r.id == "living_room" for r in rooms):
                        root = rooms[0].id
                    ev = E.evaluate_floor(rooms, F, D, fi, nfl, root, None, targets)
                    if ev.ok:
                        found.append(E.FloorSol(rooms, ev, 0.0, "strip"))
                        if len(found) >= 10:
                            break
                if not found:
                    ok = False
                    break
                per_floor.append(found)
            if not ok:
                continue
            stats["floors_ok"] += 1
            stats.setdefault("first_ok_s", round(time.time() - t0, 2))
            for cands in per_floor:
                cands.sort(key=lambda c: sum(c.ev.features.values()), reverse=True)
            u_off = snap_down((F0 - F) / 2, GRID)
            for k in range(min(len(c) for c in per_floor)):
                floors = [pf[k] for pf in per_floor]
                for mirror in (False, True):
                    fl = floors
                    if mirror:
                        fl = []
                        for fi_, f in enumerate(floors):
                            mr = E._mirror_rooms(f.rooms, F)
                            root_ = "living_room" if fi_ == 0 and any(x.id == "living_room" for x in mr) else ("staircase" if fi_ > 0 else mr[0].id)
                            ev_ = E.evaluate_floor(mr, F, D, fi_, nfl, root_, None, targets)
                            if not ev_.ok:
                                fl = None
                                break
                            fl.append(E.FloorSol(mr, ev_, f.cost, f.family))
                        if fl is None:
                            continue
                    mp = E._mapper(site, F, D, box["yard_depth"], u_off)
                    vs = [E.vastu_score(f.rooms, mp, mode) for f in fl]
                    feats = E._plan_feats(fl)
                    feats["service"] = 0.6 * feats["service"] + 0.4 * E._stack_bonus(fl)
                    feats["coverage"] = min(1.0, (F * D) / max(1.0, F0 * Dbox))
                    ps = E.PlanSol(fl, F, D, "strip", None, mirror, feats, sum(vs) / len(vs))
                    ps.u_off = u_off
                    ps.program = program_i
                    ps.notes = ["Laid out around a single corridor (spine) because this plot is too shallow or small for the usual band layout."]
                    pool.append(ps)
        for p_ in pool:
            p_.score = E._profile_score(p_, "balanced")
        return {"ok": True, "feasibility": E.analyse(site, program), "program": base_program, "plans": pool, "site": site, "F": F0, "D": dmax,
                "yard": box["yard_depth"], "rounds": stats["rounds"], "stats": stats, "elapsed": time.time() - t0}
    finally:
        STRICT.update(saved)
        set_aspect(old_aspect)
