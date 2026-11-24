"""Candidate generation for one floor: structure -> exact sizes -> rooms."""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

from backend.planner.architect.geometry import Room
from backend.planner.architect.program import RoomSpec
from backend.planner.architect.rules import STRICT, BEDROOM_TYPES, DEPTH_PREF, GRID, HABITABLE, PARKING_TYPES, rule_for, _COMPACT
from backend.planner.architect.sizing import (
    BandSpec, CellPlan, band_depth_options, size_bands, stack_split,
)

STACKABLE = {
    frozenset({"bathroom"}), frozenset({"bathroom", "utility"}), frozenset({"toilet", "bathroom"}),
    frozenset({"toilet", "utility"}), frozenset({"toilet", "puja_room"}),
    # an attached bath may sit beside its bedroom across a deep band (deep bands come from the 1 m-landing stair)
    frozenset({"bedroom", "bathroom"}), frozenset({"master_bedroom", "bathroom"}), frozenset({"guest_bedroom", "bathroom"}),
    frozenset({"bathroom", "puja_room"}), frozenset({"utility", "puja_room"}),
    frozenset({"kitchen", "utility"}),
}


@dataclass
class Cell:
    specs: List[RoomSpec]
    fixed_w: Optional[float] = None
    min_w: Optional[float] = None
    _plan: Optional[CellPlan] = field(default=None, repr=False, compare=False)

    def plan(self) -> CellPlan:
        # a cell is finished (specs, fixed_w, min_w) before anything asks for its plan, and is asked many times
        # (every depth test and every realisation), so the immutable plan is built once
        p = self._plan
        if (p is None or p.fixed_w != self.fixed_w or p.min_w != self.min_w or len(p.types) != len(self.specs)
                or any(t != sp.type or tg != sp.target for t, tg, sp in zip(p.types, p.targets, self.specs))):
            p = self._plan = CellPlan(tuple(s.type for s in self.specs), tuple(s.target for s in self.specs), self.fixed_w, self.min_w)
        return p


@dataclass
class SBand:
    kind: str                                   # rooms | corridor | core
    segments: List[Tuple[List[Cell], float]]    # (cells, extent along A)
    fixed_depth: Optional[float] = None


@dataclass
class Pin:
    """Where the staircase sits; identical on every floor."""
    a0: float          # start along A
    wa: float          # stair extent along A
    b0: float          # start of the core band along B
    db: float          # core band depth


@dataclass
class Struct:
    family: str                # rows | cols
    bands: List[SBand]
    A: float
    B: float
    pin_b0: Optional[float] = None
    _bs: Optional[list] = field(default=None, repr=False, compare=False)    # memo of _band_specs (the bands are final once built)


def _pref_b(spec: RoomSpec, family: str, public_first: bool, attached_pref: Dict[str, float]) -> float:
    """Preferred position along B in 0..1 for assignment to bands."""
    if family == "rows":
        if spec.type == "bathroom" and spec.attached_to in attached_pref:
            return attached_pref[spec.attached_to]
        return DEPTH_PREF.get(spec.type, 0.5)
    # columns: band index runs across the frontage; public rooms on one side
    pub = {"living_room", "dining", "kitchen", "utility", "puja_room", "study", "guest_bedroom"}
    priv = BEDROOM_TYPES | {"bathroom"}
    if spec.type == "bathroom" and spec.attached_to in attached_pref:
        return attached_pref[spec.attached_to]
    if spec.type in pub:
        v = 0.12
    elif spec.type in priv:
        v = 0.88
    else:
        v = 0.5
    return v if public_first else 1.0 - v


def _pref_a(spec: RoomSpec, family: str) -> float:
    if family == "cols":
        return DEPTH_PREF.get(spec.type, 0.5)      # order front -> rear along the column
    return random.random()


def _is_hab_cell(cell: Cell) -> bool:
    return any(sp.type in HABITABLE for sp in cell.specs)


import itertools as _it
_PASS_IDS = _it.count(100)       # passage ids must be unique across the whole floor (two passages once shared an id)


_WET3 = frozenset({"bathroom", "toilet", "utility"})
# STACKABLE as ordered type pairs, so a pair test is one set lookup instead of building a frozenset per test
_STACK2 = frozenset([(a, b) for fs in STACKABLE for a in fs for b in fs if (len(fs) == 2 and a != b) or len(fs) == 1])


def _utypes(u: List[Cell]) -> set:
    return {sp.type for c in u for sp in c.specs}


def _orient_pair(cell: Cell, ext_side: Optional[str]) -> None:
    if ext_side and len(cell.specs) == 2:
        h = [sp for sp in cell.specs if sp.type in HABITABLE]
        if len(h) == 1:
            o = [sp for sp in cell.specs if sp.type not in HABITABLE]
            cell.specs[:] = h + o if ext_side == "low" else o + h


def _balcony_beside_room(cells: List[Cell]) -> List[Cell]:
    """A balcony is entered from a bedroom or lounge, never through a bathroom or from a corridor: when the cells beside it are
    neither, swap one of them with a self-contained room cell of the band (a lounge, or a bedroom stacked with its bath)."""
    ROOMY = BEDROOM_TYPES | {"family_lounge", "living_room"}

    def types(c: Cell) -> set:
        return {sp.type for sp in c.specs}

    def movable(c: Cell) -> bool:          # does not split a bedroom from its single attached bath
        return not any(sp.attached_to for sp in c.specs) and not (len(c.specs) == 1 and c.specs[0].type in BEDROOM_TYPES)

    for i, c in enumerate(cells):
        if len(c.specs) != 1 or c.specs[0].type != "balcony":
            continue
        if any(0 <= j < len(cells) and types(cells[j]) & ROOMY for j in (i - 1, i + 1)):
            continue
        swapped = False
        for d in (-1, 1):                  # [bedroom, its bath, balcony] -> [bath, bedroom, balcony]
            j, k = i + d, i + 2 * d
            if 0 <= j < len(cells) and 0 <= k < len(cells) and len(cells[j].specs) == 1 and len(cells[k].specs) == 1:
                b, r = cells[j].specs[0], cells[k].specs[0]
                if b.type == "bathroom" and b.attached_to == r.id:
                    cells[j], cells[k] = cells[k], cells[j]
                    swapped = True
                    break
        if swapped:
            continue
        done = False
        for d in (-1, 1):
            j = i + d
            if not (0 <= j < len(cells)) or not movable(cells[j]):
                continue
            for k, ck in enumerate(cells):
                if k in (i, j) or not (types(ck) & ROOMY) or not (len(ck.specs) == 2 or ck.specs[0].type in ("family_lounge", "living_room")):
                    continue
                if any(sp.type == "bathroom" for sp in ck.specs) and not any(sp.type in BEDROOM_TYPES for sp in ck.specs):
                    continue
                cells[j], cells[k] = cells[k], cells[j]
                done = True
                break
            if done:
                break
    return cells


def _make_cells_raw(rng: random.Random, specs: List[RoomSpec], family: str,
                p_stack: float, p_pass: float, passage_proto: RoomSpec,
                inner: bool = False, ext_side: Optional[str] = None) -> Optional[List[Cell]]:
    """Order rooms into cells along the band.

    `inner` bands (not on the footprint edge) only give daylight at their two
    ends, so at most two habitable units may be there and they sit at the ends.
    """
    strict = STRICT["on"]
    uniform = rng.uniform
    if family == "rows":
        grand = random.random
        keyed = [(grand() + uniform(-0.12, 0.12), i, s) for i, s in enumerate(specs)]
        rng.shuffle(keyed)
    else:
        keyed = [(DEPTH_PREF.get(s.type, 0.5) + uniform(-0.12, 0.12), i, s) for i, s in enumerate(specs)]
        keyed.sort(key=lambda t: t[0])
    ordered = [t[2] for t in keyed]
    ids = {o.id for o in ordered}
    # attached baths by their room, in the order they appear: a room, optionally followed by its attached bath, stays contiguous
    kids: Dict[str, List[RoomSpec]] = {}
    for bsp in ordered:
        if bsp.type == "bathroom" and bsp.attached_to:
            kids.setdefault(bsp.attached_to, []).append(bsp)
    units: List[List[RoomSpec]] = []
    placed = set()
    for sp in ordered:
        if sp.id in placed:
            continue
        if sp.type == "bathroom" and sp.attached_to in ids:
            continue
        unit = [sp]; placed.add(sp.id)
        for bsp in kids.get(sp.id, ()):
            if bsp.id not in placed:
                unit.append(bsp); placed.add(bsp.id)
        units.append(unit)
    for bsp in ordered:                                  # leftovers
        if bsp.id not in placed:
            units.append([bsp]); placed.add(bsp.id)
    # stack neighbouring rooms into two-room cells when allowed
    ucells: List[List[Cell]] = []
    compact = _COMPACT["f"] < 1.0
    hi_stack = max(p_stack, 0.85)
    rnd = rng.random
    for unit in units:
        cells: List[Cell] = []
        i = 0
        n = len(unit)
        while i < n:
            sp = unit[i]
            if i + 1 < n:
                t1, t2 = sp.type, unit[i + 1].type
                thr = hi_stack if (strict and (t1 in _WET3 or t2 in _WET3)) else p_stack
                if rnd() < thr and ((t1, t2) in _STACK2 or (compact and ((t1 == "dining" and t2 == "kitchen") or (t1 == "kitchen" and t2 == "dining")))):
                    pair = [sp, unit[i + 1]]
                    rng.shuffle(pair)
                    cells.append(Cell(pair)); i += 2
                    continue
            cells.append(Cell([sp])); i += 1
        ucells.append(cells)
    for u in ucells:
        for c in u:
            _orient_pair(c, ext_side)
    # a few stack candidates among independent single units (utility/kitchen, bath/utility ...)
    j = 0
    while j + 1 < len(ucells):
        u1, u2 = ucells[j], ucells[j + 1]
        if len(u1) == 1 and len(u2) == 1 and len(u1[0].specs) == 1 and len(u2[0].specs) == 1 \
                and rng.random() < p_stack \
                and not u1[0].specs[0].attached_to and not u2[0].specs[0].attached_to \
                and frozenset({u1[0].specs[0].type, u2[0].specs[0].type}) in STACKABLE \
                and u1[0].specs[0].type != "bedroom" and u2[0].specs[0].type != "bedroom" \
                and u1[0].specs[0].type != "master_bedroom" and u2[0].specs[0].type != "master_bedroom":
            nc = Cell([u1[0].specs[0], u2[0].specs[0]])
            _orient_pair(nc, ext_side)
            ucells[j] = [nc]
            del ucells[j + 1]
        j += 1
    # passage as its own unit
    n_priv = sum(1 for u in ucells if not _utypes(u).isdisjoint(BEDROOM_TYPES))
    n_pass = (1 if rng.random() < p_pass else 0) + (1 if n_priv >= 2 and rng.random() < 0.4 else 0)
    if STRICT["on"]:
        n_pass = 1 if (p_pass > 0 and rng.random() < p_pass) else 0     # strict: at most one, only when asked for
    rng.shuffle(ucells)
    if STRICT["on"]:
        # dining - kitchen - utility are one connected group; the kitchen (with its utility stacked on it) ends the row
        ku = next((u for u in ucells if "kitchen" in _utypes(u)), None)
        du = next((u for u in ucells if "dining" in _utypes(u) and u is not ku), None)
        if ku is not None:
            ucells.remove(ku)
            if du is not None:
                ucells.remove(du)
                ucells.extend([du, ku])
            else:
                ucells.append(ku)
            if rng.random() < 0.5:
                ucells.reverse()
    for k in range(n_pass):
        ps = RoomSpec(f"passage_{next(_PASS_IDS)}", "passage", "Passage", passage_proto.floor, 55.0)
        lo = 1 if (n_priv >= 2 and len(ucells) > 1) else 0
        hi = len(ucells) - 1 if (n_priv >= 2 and len(ucells) > 1) else len(ucells)
        ucells.insert(rng.randint(lo, max(lo, hi)), [Cell([ps])])
    front: Optional[List[Cell]] = None
    if family == "cols":                       # the entry room must sit on the road
        for u in ucells:
            if "living_room" in _utypes(u):
                front = u
                break
        if front is not None:
            ucells.remove(front)
    if inner:
        if front is not None:
            ucells.insert(0, front)
            front = None
        hab = [u for u in ucells if not _utypes(u).isdisjoint(HABITABLE)]
        hab_ids = {id(u) for u in hab}
        non = [u for u in ucells if id(u) not in hab_ids]
        if len(hab) > 2:
            return None
        rng.shuffle(non)
        rng.shuffle(hab)
        if family == "cols":
            for k, u in enumerate(hab):
                if "living_room" in _utypes(u):
                    hab.insert(0, hab.pop(k))
                    break
        left: List[List[Cell]] = []
        right: List[List[Cell]] = []
        for u in hab:
            side = left if (not left and (len(hab) == 2 or rng.random() < 0.5)) else right
            if side is right and right:
                side = left
            side.append(u)
        # habitable cell must be the outer one of its unit
        def orient(u, outer_first):
            hs = [c for c in u if _is_hab_cell(c)]
            ns = [c for c in u if not _is_hab_cell(c)]
            if len(hs) > 1:
                return u
            return hs + ns if outer_first else ns + hs
        ordered_units = [orient(u, True) for u in left] + non + [orient(u, False) for u in right]
        return _balcony_beside_room([c for u in ordered_units for c in u])
    rng.shuffle(ucells)
    if front is not None:
        ucells.insert(0, front)
    return _balcony_beside_room([c for u in ucells for c in u])


def _make_cells(rng, specs, family, p_stack, p_pass, passage_proto, inner=False, ext_side=None):
    cells = _make_cells_raw(rng, specs, family, p_stack, p_pass, passage_proto, inner, ext_side)
    if cells is not None:
        from backend.planner.architect.rules import park_width
        for c in cells:                                 # a car porch is built to the exact width of its vehicles
            if len(c.specs) == 1 and c.specs[0].type in PARKING_TYPES:
                c.min_w = park_width(c.specs[0].type, c.specs[0].role)
    return cells


def _build_once(rng: random.Random, specs: List[RoomSpec], stair: Optional[RoomSpec], floor: int,
                 family: str, A: float, B: float, pin: Optional[Pin], nb_rooms: int,
                 corridor: Optional[int], public_first: bool, noise: float,
                 p_stack: float, p_pass: float, extra_specs: Sequence[RoomSpec] = ()) -> Optional[Struct]:
    """Randomly assign rooms to bands. Returns None for degenerate choices."""
    all_specs = list(specs) + list(extra_specs)
    proto = RoomSpec("p", "passage", "Passage", floor, 55.0)
    # --- band skeleton (kind, approx centre fraction along B) ---------------------
    skeleton: List[Tuple[str, float]] = []
    if pin is not None:
        fr, rr = pin.b0, B - pin.b0 - pin.db
        nf = 0 if fr < 0.5 else (1 if fr <= 17.5 else 2)
        nr = 0 if rr < 0.5 else (1 if rr <= 17.5 else 2)
        front_cor = corridor == 1 and 12.0 <= fr <= 17.5
        rear_cor = corridor == 2 and 12.0 <= rr <= 17.5
        if front_cor or rear_cor:
            nf = 1 if fr >= 0.5 else 0
            nr = 1 if rr >= 0.5 else 0
        for k in range(nf):
            lo = fr * k / nf; hi = fr * (k + 1) / nf
            skeleton.append(("rooms", (lo + hi) / 2 / B))
        if front_cor:
            skeleton.append(("corridor", (fr - 2) / B))
        skeleton.append(("core", (pin.b0 + pin.db / 2) / B))
        if rear_cor:
            skeleton.append(("corridor", (pin.b0 + pin.db + 2) / B))
        for k in range(nr):
            lo = pin.b0 + pin.db + rr * k / nr; hi = pin.b0 + pin.db + rr * (k + 1) / nr
            skeleton.append(("rooms", (lo + hi) / 2 / B))
    else:
        for k in range(nb_rooms):
            skeleton.append(("rooms", (k + 0.5) / nb_rooms))
        if corridor is not None and 0 < corridor < nb_rooms:
            skeleton.insert(corridor, ("corridor", corridor / nb_rooms))
    band_idx = [i for i, (k, _) in enumerate(skeleton) if k in ("rooms", "core")]
    if not band_idx:
        return None
    centres = [skeleton[i][1] for i in band_idx]
    # --- assign rooms: order by zoning preference, cut into contiguous groups whose
    #     target areas match each band's share of the footprint ------------------
    cap = []
    for i in band_idx:
        if pin is not None:
            kind, c = skeleton[i]
            depth = pin.db if kind == "core" else (B - pin.db) / max(1, sum(1 for k, _ in skeleton if k == "rooms"))
            extra = -(stair.target if (kind == "core" and stair) else 0.0)
        else:
            depth = B / len(band_idx)
            extra = 0.0
        cap.append(max(A * depth + extra, 20.0))
    keyed = []
    attached_pref: Dict[str, float] = {}
    plain = [s for s in all_specs if not (s.type == "bathroom" and s.attached_to
                                          and any(x.id == s.attached_to for x in all_specs))]
    kids: Dict[str, List[RoomSpec]] = {}
    for s in all_specs:
        if s.type == "bathroom" and s.attached_to and any(x.id == s.attached_to for x in all_specs):
            kids.setdefault(s.attached_to, []).append(s)
    for s in plain:
        p = _pref_b(s, family, public_first, attached_pref) + rng.gauss(0, noise)
        keyed.append((p, s))
    keyed.sort(key=lambda t: t[0])
    groups = [(s, [s] + kids.get(s.id, [])) for _, s in keyed]
    total = sum(sp.target for _, g in groups for sp in g)
    capsum = sum(cap)
    assigned: Dict[int, List[RoomSpec]] = {i: [] for i in band_idx}
    acc = 0.0
    j = 0
    bound = cap[0] / capsum * total * (1 + rng.uniform(-0.1, 0.1))
    for _, g in groups:
        area = sum(sp.target for sp in g)
        # advance when the midpoint of this group passes the band boundary
        while j < len(band_idx) - 1 and acc + area / 2 > bound:
            j += 1
            bound += cap[j] / capsum * total * (1 + rng.uniform(-0.1, 0.1))
        assigned[band_idx[j]].extend(g)
        acc += area
    # the car porch must touch the road: it always goes in the first band
    if any(x.type in PARKING_TYPES for x in all_specs):
        # ... and so does the living room beside it, which holds the main door on the road side
        for sp in [x for x in all_specs if x.type in PARKING_TYPES or x.type == "living_room"]:
            for bi in band_idx:
                if sp in assigned[bi] and bi != band_idx[0]:
                    assigned[bi].remove(sp)
                    assigned[band_idx[0]].append(sp)
    # a balcony is entered from a bedroom or lounge: it goes into a band that holds one (an outer band, where it has daylight)
    roomy = BEDROOM_TYPES | {"family_lounge", "living_room"}
    for sp in [x for x in all_specs if x.type == "balcony"]:
        cur = next((bi for bi in band_idx if sp in assigned[bi]), None)
        if cur is None or any(x.type in roomy for x in assigned[cur]):
            continue
        outer = [bi for bi in (band_idx[0], band_idx[-1]) if any(x.type in roomy for x in assigned[bi])]
        if outer:
            assigned[cur].remove(sp)
            assigned[rng.choice(outer)].append(sp)
    # rooms bands must not be empty (core band may hold only the stair)
    for bi in band_idx:
        if skeleton[bi][0] == "rooms" and not assigned[bi]:
            donor = max(assigned, key=lambda x: len(assigned[x]))
            if len(assigned[donor]) < 2:
                return None
            assigned[bi].append(assigned[donor].pop(rng.randrange(len(assigned[donor]))))
    # --- place the corridor where it touches every band that holds a bedroom ---------
    if pin is None and any(k == "corridor" for k, _ in skeleton):
        rank = [i for i, (k, _) in enumerate(skeleton) if k == "rooms"]
        nr = len(rank)
        if nr >= 2:
            bed_ranks = [r for r, i in enumerate(rank)
                         if any(sp.type in BEDROOM_TYPES for sp in assigned[i])]
            good = [c for c in range(1, nr)
                    if all(r in (c - 1, c) for r in bed_ranks)]
            cur = [i for i, (k, _) in enumerate(skeleton) if k == "corridor"][0]
            if not good:
                return None
            if good and cur not in good:
                c = rng.choice(good)
                pos_f = [f for _, f in skeleton if _ == "rooms"] if False else None
                new_sk = []
                new_assigned: Dict[int, List[RoomSpec]] = {}
                for r, i in enumerate(rank):
                    if r == c:
                        new_sk.append(("corridor", c / nr))
                    new_assigned[len(new_sk)] = assigned[i]
                    new_sk.append(skeleton[i])
                skeleton = new_sk
                assigned = new_assigned
                band_idx = [i for i, (k, _) in enumerate(skeleton) if k in ("rooms", "core")]

    has_corridor = any(k == "corridor" for k, _ in skeleton)
    has_porch = any(x.type in PARKING_TYPES for x in all_specs)

    # No corridor band on an upper floor: the stair must arrive at a lounge (the hub) lying across its entry end.  Put the family lounge in the
    # band at that end, over the stair (the stair is entered at its low end, or its high end when the low end is on the building edge).
    entry_band = None
    lounge = next((x for x in all_specs if x.type == "family_lounge"), None)
    if floor > 0 and pin is not None and not has_corridor and lounge is not None and pin.db >= pin.wa:
        ci = next((i for i, (k, _) in enumerate(skeleton) if k == "core"), None)
        if ci is not None:
            ni = ci - 1 if pin.b0 >= 0.5 else ci + 1
            if 0 <= ni < len(skeleton) and skeleton[ni][0] == "rooms" and ni in (0, len(skeleton) - 1):   # an outer band: the lounge needs daylight
                entry_band = ni
                for bi in list(assigned):
                    if lounge in assigned[bi] and bi != ni:
                        assigned[bi].remove(lounge)
                        assigned[ni].append(lounge)

    def hub_side(i):
        """Side ('low' / 'high') of band i on which a corridor band lies: a bedroom stacked with its bath must face it (the bath behind)."""
        if floor > 0 and i > 0 and skeleton[i - 1][0] == "corridor":
            return "low"
        if floor > 0 and i < len(skeleton) - 1 and skeleton[i + 1][0] == "corridor":
            return "high"
        return None

    def make(assigned):
        bands: List[SBand] = []
        for i, (kind, _) in enumerate(skeleton):
            if kind == "corridor":
                cs = RoomSpec(f"corridor_{floor}", "passage", "Passage", floor, A * 4.0)
                bands.append(SBand("corridor", [([Cell([cs])], A)]))
            elif kind == "rooms":
                first_last = i == 0 or i == len(skeleton) - 1
                has_bed = any(sp.type in BEDROOM_TYPES for sp in assigned[i])
                ext = None if not first_last else ("low" if i == 0 else "high")
                if len(skeleton) == 1:
                    ext = None
                if ext is None:
                    ext = hub_side(i)
                pp_ = (max(p_pass, 0.7 if has_bed else 0.0) if (p_pass > 0 or not STRICT["on"]) else 0.0)
                if floor > 0 and (has_corridor or lounge is not None):
                    pp_ = 0.0              # an upper floor with a corridor band needs no extra stray passages (they end up unreachable)
                cells = _make_cells(rng, assigned[i], family, p_stack, pp_,
                                    proto, inner=not first_last, ext_side=ext)
                if cells is None:
                    return None
                if i == entry_band and cells:
                    k = next((j for j, c_ in enumerate(cells) if any(sp.type == "family_lounge" for sp in c_.specs)), None)
                    if k is not None:                          # the lounge cell goes over the stair
                        c_ = cells.pop(k)
                        if pin.a0 + pin.wa / 2 < A / 2:
                            cells.insert(0, c_)
                        else:
                            cells.append(c_)
                bands.append(SBand("rooms", [(cells, A)]))
            else:   # core band with the pinned staircase
                core_edge = i == 0 or i == len(skeleton) - 1
                pp_core = (max(p_pass * 0.7, 0.8 if any(sp.type in BEDROOM_TYPES for sp in assigned[i]) else 0.0) if (p_pass > 0 or not STRICT["on"]) else 0.0)
                if floor == 0 and has_porch and not core_edge:
                    pp_core = max(pp_core, 0.9)     # the living room beside the porch needs a hall to reach the stair and kitchen
                cells = _make_cells(rng, assigned[i], family, p_stack, pp_core, proto,
                                    inner=not core_edge,
                                    ext_side=hub_side(i) if not core_edge else ("low" if i == 0 else "high"))
                if cells is None:
                    return None
                left, right = [], []
                # split cells around the stair according to its position
                if pin.a0 < 0.5:
                    right = cells
                elif pin.a0 + pin.wa > A - 0.5:
                    left = cells
                else:
                    cut = rng.randint(0, len(cells))
                    left, right = cells[:cut], cells[cut:]
                st = Cell([stair], fixed_w=pin.wa)
                segs = [(left, pin.a0), ([st], pin.wa), (right, A - pin.a0 - pin.wa)]
                segs = [sg for sg in segs if sg[0] or sg[1] > 0.5]
                bands.append(SBand("core", segs, fixed_depth=pin.db))
        if floor == 0 and pin is not None:
            cb = next((b for b in bands if b.kind == "core"), None)
            if cb is not None and bands[0].kind == "rooms" and bands[0] is not cb:
                _ground_halls(bands[0], cb, pin.a0, has_porch)
        return Struct(family, bands, A, B, pin.b0 if pin is not None else None)

    def move_group(src: int, dst: int) -> bool:
        movable = [sp for sp in assigned[src]
                   if sp.type not in ("living_room", "staircase", "parking", "bike_parking")
                   and not (sp.type == "bathroom" and sp.attached_to
                            and any(x.id == sp.attached_to for x in assigned[src]))]
        if not movable or (len(assigned[src]) <= 1 and skeleton[src][0] == "rooms"):
            return False
        sp = rng.choice(movable)
        group = [sp] + [x for x in assigned[src] if x.type == "bathroom" and x.attached_to == sp.id]
        for g in group:
            assigned[src].remove(g)
            assigned[dst].append(g)
        return True

    def enforce_inner() -> bool:
        """Inner bands only get daylight at their ends: at most two habitable rooms there."""
        bi_ = [i for i, (kd, _) in enumerate(skeleton) if kd in ("rooms", "core")]
        for _ in range(10):
            moved = False
            for pos_, i in enumerate(bi_):
                if i == 0 or i == len(skeleton) - 1:
                    continue
                hab_ = [sp for sp in assigned[i] if sp.type in HABITABLE]
                if len(hab_) > 2:
                    nb_ = [bi_[q] for q in (pos_ - 1, pos_ + 1) if 0 <= q < len(bi_)]
                    cand_ = [sp for sp in hab_ if sp.type != "living_room"]
                    if not cand_ or not nb_:
                        return False
                    sp = rng.choice(cand_)
                    dst_ = min(nb_, key=lambda x: (0 if (x == 0 or x == len(skeleton) - 1) else 1, len(assigned[x])))
                    for g in [sp] + [x for x in assigned[i] if x.type == "bathroom" and x.attached_to == sp.id]:
                        assigned[i].remove(g); assigned[dst_].append(g)
                    moved = True
            if not moved:
                return True
        return False

    for _ in range(6):
        if not enforce_inner():
            return None
        st = make(assigned)
        if st is None:
            return None
        opts = [band_depth_options(bs, B) for bs in _band_specs(st)]
        bad = [k for k, o in enumerate(opts) if not o and st.bands[k].kind != "corridor"]
        if not bad:
            return st
        k = rng.choice(bad)
        bi = [i for i, (kd, _) in enumerate(skeleton) if kd in ("rooms", "core")]
        pos = bi.index(k) if k in bi else None
        if pos is None:
            return None
        nbrs = [bi[q] for q in (pos - 1, pos + 1) if 0 <= q < len(bi)]
        if not nbrs:
            return None
        # prefer the neighbour with the fewest rooms
        filled = sum(sp.target for sp in assigned[k])
        capk = cap[band_idx.index(k)] if k in band_idx else 0.0
        if filled < 0.8 * capk * (total / capsum):            # starved: pull a room in
            src = max(nbrs, key=lambda x: len(assigned[x]) + rng.random())
            if move_group(src, k):
                continue
        dst = min(nbrs, key=lambda x: len(assigned[x]) + rng.random())
        if not move_group(k, dst):
            return None
    return None


_HALL = ("dining", "passage", "family_lounge")


def _hall_at(grp, idx, avoid=()) -> None:
    """Make the cell at grp[idx] a hall / dining cell (swap one in from elsewhere in the group) if it is not one already."""
    if any(sp.type in _HALL for sp in grp[idx].specs):
        return
    for k, c in enumerate(grp):
        if k != idx and k not in avoid and any(sp.type in _HALL for sp in c.specs):
            grp[idx], grp[k] = grp[k], grp[idx]
            return


def _ground_halls(front: "SBand", core: "SBand", a0: float, porch: bool) -> None:
    """Ground floor: the stair is entered at one short end, and a bath / kitchen / bedroom there leaves it unreachable; put a hall or dining cell
    beside that end.  With a car porch the living room (the entrance root) is also mirrored over the end away from the stair, with a hall cell under
    it, so that the root has a door into the rest of the house."""
    ci = next((k for k, sg in enumerate(core.segments) if any(sp.type == "staircase" for c in sg[0] for sp in c.specs)), None)
    if ci is None:
        return
    left = core.segments[ci - 1][0] if ci > 0 else []
    right = core.segments[ci + 1][0] if ci + 1 < len(core.segments) else []
    if porch and bool(left) != bool(right) and len(front.segments) == 1 and front.kind == "rooms":
        fcells = front.segments[0][0]
        li = next((k for k, c in enumerate(fcells) if any(sp.type == "living_room" for sp in c.specs)), None)
        if li is not None and (li < len(fcells) / 2) != bool(left):
            fcells.reverse()
    use_right = a0 < 0.5 and bool(right)
    ent_grp = right if use_right else left
    if not ent_grp:
        return
    ent = 0 if use_right else len(ent_grp) - 1
    _hall_at(ent_grp, ent)
    if porch and bool(left) != bool(right):
        grp = left or right
        end = 0 if left else len(grp) - 1                # the cell under the living room
        if grp is ent_grp and end == ent:
            return
        _hall_at(grp, end, avoid=(ent,) if grp is ent_grp else ())


def realise(struct: Struct, floor: int) -> Optional[Tuple[List[Room], float]]:
    """Size a structure exactly. Returns (rooms in canonical coords, cost)."""
    specs = []
    for band in struct.bands:
        segs = []
        for cells, extent in band.segments:
            segs.append(([c.plan() for c in cells], extent))
        specs.append(BandSpec(segs, fixed_depth=band.fixed_depth,
                              min_depth=3.5 if band.kind == "corridor" else 6.0,
                              max_depth=5.5 if band.kind == "corridor" else 30.0,
                              prefer_depth=4.0 if band.kind == "corridor" else None))
    core = None
    if struct.pin_b0 is not None:
        core = (next(i for i, b in enumerate(struct.bands) if b.kind == "core"), struct.pin_b0)
    res = size_bands(specs, struct.B, core)
    if res is None:
        return None
    chosen, cost = res
    rooms: List[Room] = []
    b_off = 0.0
    for band, (depth, seg_widths) in zip(struct.bands, chosen):
        a_off = 0.0
        for (cells, extent), widths in zip(band.segments, seg_widths):
            for cell, w in zip(cells, widths):
                if len(cell.specs) == 1:
                    s = cell.specs[0]
                    parts = [(s, a_off, b_off, w, depth)]
                else:
                    s1, s2 = cell.specs
                    e1 = stack_split(s1.type, s2.type, w, depth, s1.target, s2.target)
                    if e1 is None:
                        return None
                    parts = [(s1, a_off, b_off, w, e1), (s2, a_off, b_off + e1, w, depth - e1)]
                for s, a, b, wa, wb in parts:
                    if struct.family == "rows":
                        rooms.append(Room(s.id, s.type, s.name, s.floor, a, b, wa, wb, s.attached_to, s.role))
                    else:
                        rooms.append(Room(s.id, s.type, s.name, s.floor, b, a, wb, wa, s.attached_to, s.role))
                a_off += w
        b_off += depth
    return rooms, cost


def _band_specs(struct: Struct) -> List[BandSpec]:
    if struct._bs is not None:
        return struct._bs
    struct._bs = [BandSpec([([c.plan() for c in cells], ext) for cells, ext in b.segments],
                     fixed_depth=b.fixed_depth,
                     min_depth=3.5 if b.kind == "corridor" else 6.0,
                     max_depth=5.5 if b.kind == "corridor" else 30.0,
                     prefer_depth=4.0 if b.kind == "corridor" else None) for b in struct.bands]
    return struct._bs


def build_struct(rng, specs, stair, floor, family, A, B, pin, nb_rooms, corridor,
                 public_first, noise, p_stack, p_pass, extra_specs=(), tries: int = 5):
    """Random structure that passes the cheap per-band feasibility test."""
    for _ in range(tries):
        st = _build_once(rng, specs, stair, floor, family, A, B, pin, nb_rooms, corridor,
                         public_first, noise, p_stack, p_pass, extra_specs)
        if st is None:
            continue
        opts = [band_depth_options(bs, B) for bs in _band_specs(st)]
        if any(not o for o in opts):
            continue
        reach = {0}
        for bi_, o in enumerate(opts):
            if st.pin_b0 is not None and st.bands[bi_].kind == "core":
                reach = {r for r in reach if r == int(round(st.pin_b0 / GRID))}
            reach = {r + d for r in reach for d in o}
        if int(round(B / GRID)) in reach:
            return st
    return None
