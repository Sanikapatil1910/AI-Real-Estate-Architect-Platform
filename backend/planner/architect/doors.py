"""Door and window placement on a tiled floor (canonical frame)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Set, Tuple

from backend.planner.architect.circulation import arrival_issues, is_outdoor, may_walk_through
from backend.planner.architect.geometry import Room, exterior_sides, shared_wall
from backend.planner.architect.rules import (
    BEDROOM_TYPES, DOOR_WIDTH, EPS, HABITABLE_WINDOW_TYPES, STRICT, TWO_WINDOW_WALL_FT, WINDOW_HEAD, WINDOW_MAX_SHARE, WINDOW_PIER_FT,
    PASSAGE_WINDOW_SPACING_FT, WINDOW_SILL, WINDOW_WIDTH, door_allowed, door_label,
)

MIN_BATH_WALL = 3.5
LANDING_DEPTH = 4.0          # an upstairs landing may open sideways within this depth of the stair's entry end
MIN_WALL = 4.0

# preference weights for a door between two room types (higher = better)
_W = {
    frozenset({"living_room", "dining"}): 10,
    frozenset({"dining", "kitchen"}): 10,
    frozenset({"kitchen", "utility"}): 10,
    frozenset({"passage", "bedroom"}): 9,
    frozenset({"passage", "master_bedroom"}): 9,
    frozenset({"passage", "guest_bedroom"}): 9,
    frozenset({"passage", "bathroom"}): 9,
    frozenset({"passage", "toilet"}): 9,
    frozenset({"family_lounge", "toilet"}): 6,
    frozenset({"staircase", "toilet"}): 2,
    frozenset({"family_lounge", "bedroom"}): 8,
    frozenset({"family_lounge", "master_bedroom"}): 8,
    frozenset({"family_lounge", "guest_bedroom"}): 8,
    frozenset({"family_lounge", "bathroom"}): 6,
    frozenset({"passage", "staircase"}): 8,
    frozenset({"family_lounge", "open_terrace"}): 8,
    frozenset({"passage", "open_terrace"}): 6,
    frozenset({"staircase", "open_terrace"}): 5,
    frozenset({"staircase", "bedroom"}): 3,
    frozenset({"staircase", "master_bedroom"}): 3,
    frozenset({"staircase", "guest_bedroom"}): 3,
    frozenset({"staircase", "bathroom"}): 2,
    frozenset({"family_lounge", "staircase"}): 8,
    frozenset({"dining", "staircase"}): 6,
    frozenset({"living_room", "staircase"}): 5,
    frozenset({"living_room", "passage"}): 7,
    frozenset({"dining", "passage"}): 7,
    frozenset({"family_lounge", "passage"}): 8,
    frozenset({"kitchen", "passage"}): 3,
    frozenset({"utility", "passage"}): 2,
    frozenset({"living_room", "puja_room"}): 8,
    frozenset({"dining", "puja_room"}): 6,
    frozenset({"passage", "puja_room"}): 5,
    frozenset({"passage", "study"}): 8,
    frozenset({"living_room", "study"}): 6,
    frozenset({"living_room", "guest_bedroom"}): 5,
    frozenset({"living_room", "bedroom"}): 2,
    frozenset({"living_room", "master_bedroom"}): 2,
    frozenset({"balcony", "master_bedroom"}): 9,
    frozenset({"balcony", "bedroom"}): 9,
    frozenset({"balcony", "guest_bedroom"}): 8,
    frozenset({"balcony", "family_lounge"}): 9,
    frozenset({"balcony", "living_room"}): 6,
}


@dataclass
class Door:
    a: str                       # room id
    b: Optional[str]             # room id, or None for the main entrance
    p1: Tuple[float, float]      # canonical endpoints of the opening
    p2: Tuple[float, float]
    width: float
    kind: str                    # main | internal | bedroom | bathroom | ...
    wall_len: float = 0.0


@dataclass
class Window:
    room: str
    p1: Tuple[float, float]
    p2: Tuple[float, float]
    width: float
    side: str
    sill: float = 3.0          # ft above the floor
    height: float = 4.0        # ft (the head is always at WINDOW_HEAD)


@dataclass
class OpeningPlan:
    doors: List[Door]
    windows: List[Window]
    graph: Dict[str, List[str]]
    root: str
    depth: Dict[str, int]
    reasons: List[str]


def _snap(x: float, g: float = 0.5) -> float:
    return round(x / g) * g


def _segment(wall: Dict, centre: float, width: float):
    lo, hi = centre - width / 2, centre + width / 2
    if wall["axis"] == "v":              # wall along v at u = at
        return (wall["at"], lo), (wall["at"], hi)
    return (lo, wall["at"]), (hi, wall["at"])


def _door_centre(lo: float, hi: float, width: float) -> Optional[float]:
    if hi - lo < width + 1.0 - EPS:
        return None
    c = _snap((lo + hi) / 2)
    c = max(c, lo + width / 2 + 0.5)
    c = min(c, hi - width / 2 - 0.5)
    return c


def _weight(a: Room, b: Room, extra_ok: Set[Tuple[str, str]]) -> Optional[int]:
    # attached bathrooms connect only to their bedroom
    if a.type == "bathroom" and a.attached_to:
        return 100 if a.attached_to == b.id else None
    if b.type == "bathroom" and b.attached_to:
        return 100 if b.attached_to == a.id else None
    if not door_allowed(a.type, b.type) and (a.id, b.id) not in extra_ok and (b.id, a.id) not in extra_ok:
        return None
    return _W.get(frozenset({a.type, b.type}), 4)


# open-plan settings (set per request by the service): 'puja' closed|open, 'vent' Balanced|High|Cross ventilation
OPEN = {"puja": "closed", "vent": "Balanced"}


def _airy() -> bool:
    return str(OPEN.get("vent", "")).lower().startswith(("high", "cross"))


def _open_link(ta: str, tb: str) -> bool:
    """Pairs joined by an open gap (glass / curtain / no wall) instead of a walled door."""
    pair = {ta, tb}
    if pair == {"passage"}:
        return True                          # a corridor and its branch are one open space
    if pair == {"dining", "kitchen"}:
        return True
    if "puja_room" in pair and pair & {"living_room", "dining", "passage", "family_lounge"}:
        return OPEN.get("puja") == "open" or _airy()
    if pair == {"dining", "living_room"}:
        return _airy()
    return False


def _stair_rule(rooms: Sequence[Room]) -> Optional[Tuple[str, str, float]]:
    """A dog-leg stair is entered at one short end only, the same end on every floor
    (it arrives where it starts).  Returns (stair id, wall axis, wall coordinate).
    The end is the low one unless that end is on the building edge."""
    st = next((r for r in rooms if r.type == "staircase"), None)
    if st is None:
        return None
    if st.d >= st.w:
        axis, lo_at, hi_at = "u", st.v, st.v2
    else:
        axis, lo_at, hi_at = "v", st.u, st.u2
    return st.id, axis, (hi_at if lo_at < EPS else lo_at)


def plan_openings(rooms: Sequence[Room], F: float, D: float, root_id: str,
                  extra_ok: Optional[Set[Tuple[str, str]]] = None,
                  main_entrance: bool = True) -> Optional[OpeningPlan]:
    """Choose doors so every room is reachable from `root_id`; None if impossible."""
    extra_ok = extra_ok or set()
    by_id = {r.id: r for r in rooms}
    if root_id not in by_id:
        return None
    wall_used: Set[Tuple[str, str, float]] = set()       # (room, axis, coordinate): one door per wall of a room
    # candidate edges
    cand: List[Tuple[int, str, str, Dict, float]] = []
    srule = _stair_rule(rooms)
    n = len(rooms)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = rooms[i], rooms[j]
            w = _weight(a, b, extra_ok)
            if w is None:
                continue
            sw = shared_wall(a, b)
            if not sw:
                continue
            if srule and srule[0] in (a.id, b.id) and not (sw["axis"] == srule[1] and abs(sw["at"] - srule[2]) < 0.05):
                # stair doors only on its entry end; on an upper floor the top landing may instead open sideways, within the landing depth of the
                # entry end (the landing then steps straight out into the corridor / passage / lounge that runs beside the stair)
                if main_entrance or sw["axis"] == srule[1]:
                    continue
                sw = dict(sw, lo=max(sw["lo"], srule[2] - LANDING_DEPTH), hi=min(sw["hi"], srule[2] + LANDING_DEPTH))
                if sw["hi"] - sw["lo"] < MIN_WALL - EPS:
                    continue
            length = sw["hi"] - sw["lo"]
            need = MIN_BATH_WALL if {a.type, b.type} & {"bathroom", "toilet"} else MIN_WALL
            if length < need - EPS:
                continue
            cand.append((w, a.id, b.id, sw, length))
    connected = {root_id}
    chosen: List[Tuple[str, str, Dict, float]] = []
    remaining = {r.id for r in rooms} - connected
    # attached bathrooms join with their parent; never selected on their own
    while remaining:
        best = None
        for w, x, y, sw, length in cand:
            if (x in connected) == (y in connected):
                continue
            new = y if x in connected else x
            if new not in remaining:
                continue
            rn = by_id[new]
            old = x if y == new else y
            if srule and old == srule[0] and old != root_id:
                continue                     # a stair is entered, never walked through

            if rn.type == "bathroom" and rn.attached_to and rn.attached_to != old:
                continue
            ro = by_id[old]
            # nobody walks through a bedroom, bathroom, puja room, utility or terrace to reach another room: only the entry and the
            # common spaces (passage, lounge, living, dining) lead on.  A bedroom may still open onto its own bathroom and its balcony /
            # terrace, which are dead ends.  (Applies in every mode: a plan whose rooms are linked through a terrace or a bedroom is
            # not a plan.)
            if not (may_walk_through(ro.type, old, rn.type, rn.attached_to, old == root_id)
                    or (is_outdoor(rn.type) and not is_outdoor(ro.type))):
                continue
            at_end = bool(srule and srule[0] in (x, y) and sw["axis"] == srule[1] and abs(sw["at"] - srule[2]) < 0.05)
            at_end = bool(srule and srule[0] in (x, y) and sw["axis"] == srule[1] and abs(sw["at"] - srule[2]) < 0.05)
            key = (at_end, w, length)                # a stair's one door goes on its entry end when it can
            if best is None or key > best[0]:
                best = (key, x, y, sw, length, new)
        if best is None:
            return None
        _, x, y, sw, length, new = best
        chosen.append((x, y, sw, length))
        wall_used.add((x, sw["axis"], round(sw["at"], 2)))
        wall_used.add((y, sw["axis"], round(sw["at"], 2)))
        connected.add(new)
        remaining.discard(new)
    # loops that make a plan feel open: public chain doors if adjacent but not yet linked
    linked = {frozenset((x, y)) for x, y, _, _ in chosen}
    for w, x, y, sw, length in cand:
        if STRICT["on"]:
            break                            # strict: exactly the doors needed for movement, no loops
        if srule and srule[0] in (x, y):
            continue                         # no extra loop doors on the stair
        if w >= 10 and w < 100 and frozenset((x, y)) not in linked:
            chosen.append((x, y, sw, length))
            linked.add(frozenset((x, y)))
    if _airy():                              # airy house: dining opens onto the living room without a wall
        for w, x, y, sw, length in cand:
            if {by_id[x].type, by_id[y].type} == {"dining", "living_room"} and frozenset((x, y)) not in linked and length >= 4.0:
                chosen.append((x, y, sw, length)); linked.add(frozenset((x, y)))
    doors: List[Door] = []
    graph: Dict[str, List[str]] = {r.id: [] for r in rooms}
    for x, y, sw, length in chosen:
        a, b = by_id[x], by_id[y]
        kind = door_label(a.type, b.type)
        if _open_link(a.type, b.type):
            kind = "arch"                    # open / glass / curtain connection instead of a wall door
        width = DOOR_WIDTH.get(kind, 3.0)
        if kind == "arch" and {a.type, b.type} != {"dining", "kitchen"} or (kind == "arch" and _airy()):
            width = min(length - 1.0, 12.0)  # the whole shared wall is open
        if {a.type, b.type} & {"bathroom", "toilet"}:
            width = DOOR_WIDTH["bathroom"]
        width = min(width, length - 1.0)
        c = _door_centre(sw["lo"], sw["hi"], width)
        if c is None:
            return None
        p1, p2 = _segment(sw, c, width)
        doors.append(Door(x, y, p1, p2, width, kind, length))
        graph[x].append(y)
        graph[y].append(x)
    # main entrance on the living-room (or root) front wall
    if main_entrance:
        root = by_id[root_id]
        if root.v > EPS:
            return None
        wall = {"axis": "u", "at": 0.0, "lo": root.u, "hi": root.u2}
        width = 4.0 if root.w >= 8 else 3.5
        c = _door_centre(root.u, root.u2, width)
        if c is None:
            return None
        p1, p2 = _segment(wall, c, width)
        doors.append(Door(root_id, None, p1, p2, width, "main", root.w))
    if not main_entrance:                    # upper floor: the stair arrives onto a real corridor / lobby when several rooms must be entered
        nodes = {r.id: (r.type, r.attached_to) for r in rooms}
        if arrival_issues(nodes, {k: set(v) for k, v in graph.items()}, root_id, {r.id: r.name for r in rooms}):
            return None
    # hop depth from root
    depth = {root_id: 0}
    queue = [root_id]
    while queue:
        cur = queue.pop(0)
        for nxt in graph[cur]:
            if nxt not in depth:
                depth[nxt] = depth[cur] + 1
                queue.append(nxt)
    windows = plan_windows(rooms, F, D, list(doors))
    return OpeningPlan(doors, windows, graph, root_id, depth, [])


def _free_centre(lo: float, hi: float, width: float, blocked: List[Tuple[float, float]], margin: float = 0.5) -> Optional[float]:
    """Free window centre closest to the middle of the wall (scan on the 6 inch grid), keeping `margin` of wall beside it."""
    mid = (lo + hi) / 2
    cands = []
    c = lo + width / 2 + margin
    while c <= hi - width / 2 - margin + EPS:
        a, b = c - width / 2, c + width / 2
        if all(b <= bl - 0.5 + EPS or a >= bh + 0.5 - EPS for bl, bh in blocked):
            cands.append(c)
        c += 0.5
    if not cands:
        return None
    return min(cands, key=lambda x: abs(x - mid))


def _floor_to(x: float, g: float = 0.5) -> float:
    return int(x / g + 1e-9) * g


def open_runs(r: Room, rooms: Sequence[Room], F: float, D: float) -> Dict[str, Tuple[float, float]]:
    """Walls of `r` that look at the open air -> the longest run (lo, hi) of each.

    A side on the footprint boundary is open for its whole length.  On an upper floor a side may also face the flat roof of the floor below
    (the footprint is not covered there): the part of the side that no other room of the floor touches is an exterior wall too.
    """
    out: Dict[str, Tuple[float, float]] = {}
    for side, length in exterior_sides(r, F, D).items():
        out[side] = (r.u, r.u2) if side in ("front", "rear") else (r.v, r.v2)
    for side in ("front", "rear", "left", "right"):
        if side in out:
            continue
        if side in ("front", "rear"):
            at, lo, hi = (r.v if side == "front" else r.v2), r.u, r.u2
            touch = [(max(o.u, lo), min(o.u2, hi)) for o in rooms if o.id != r.id and o.type != "open_terrace" and abs((o.v2 if side == "front" else o.v) - at) < EPS and min(o.u2, hi) - max(o.u, lo) > EPS]
        else:
            at, lo, hi = (r.u if side == "left" else r.u2), r.v, r.v2
            touch = [(max(o.v, lo), min(o.v2, hi)) for o in rooms if o.id != r.id and o.type != "open_terrace" and abs((o.u2 if side == "left" else o.u) - at) < EPS and min(o.v2, hi) - max(o.v, lo) > EPS]
        if side == "front" and r.v < EPS or side == "rear" and abs(r.v2 - D) < EPS or side == "left" and r.u < EPS or side == "right" and abs(r.u2 - F) < EPS:
            continue
        free, cur = [], lo
        for a, b in sorted(touch):
            if a - cur > EPS:
                free.append((cur, a))
            cur = max(cur, b)
        if hi - cur > EPS:
            free.append((cur, hi))
        free = [f for f in free if f[1] - f[0] >= 3.0 - EPS]          # a sliver beside a neighbour is not a wall to put a window in
        if free:
            out[side] = max(free, key=lambda f: f[1] - f[0])
    return out


def plan_windows(rooms: Sequence[Room], F: float, D: float, main_doors: List[Door]) -> List[Window]:
    """Windows on the exterior walls, sized from the room type and the wall.

    A habitable room gets a generous window (a long wall gets a pair), a bathroom a small high ventilator. Every window keeps
    WINDOW_PIER_FT of solid wall beside it (corners, neighbouring windows) and at most WINDOW_MAX_SHARE of its wall is glazed.
    """
    wins: List[Window] = []
    for r in rooms:
        if r.type == "open_terrace":
            continue
        base = WINDOW_WIDTH.get(r.type, 3.0)
        if base <= 0:
            continue
        runs = open_runs(r, rooms, F, D)
        sides = {k: v[1] - v[0] for k, v in runs.items()}
        if not sides:
            continue
        habitable = r.type in HABITABLE_WINDOW_TYPES
        limit = 3 if habitable else 1
        sill = WINDOW_SILL.get(r.type, 3.0)
        # longest sides first
        ordered = sorted(sides.items(), key=lambda kv: -kv[1])
        count = 0
        for side, length in ordered:
            if count >= limit:
                break
            lo, hi = runs[side]
            if side in ("front", "rear"):
                at, axis = (r.v if side == "front" else r.v2), "u"
            else:
                at, axis = (r.u if side == "left" else r.u2), "v"
            blocked = []                                       # door openings on this very wall: a window keeps half a foot clear of them
            for md in main_doors:
                if r.id not in (md.a, md.b):
                    continue
                if axis == "u" and abs(md.p1[1] - at) < EPS and abs(md.p2[1] - at) < EPS:
                    blocked.append((min(md.p1[0], md.p2[0]), max(md.p1[0], md.p2[0])))
                elif axis == "v" and abs(md.p1[0] - at) < EPS and abs(md.p2[0] - at) < EPS:
                    blocked.append((min(md.p1[1], md.p2[1]), max(md.p1[1], md.p2[1])))
            wall = {"axis": axis, "at": at}
            placed: List[Tuple[float, float]] = []            # (centre, width)
            # a long wall of a habitable room: two windows with equal piers instead of one very wide one
            if habitable and length >= TWO_WINDOW_WALL_FT and count + 2 <= limit:
                w2 = _floor_to(min(base, (length - 3 * WINDOW_PIER_FT) / 2))
                if w2 >= 3.0 - EPS:
                    g = (length - 2 * w2) / 3
                    c1, c2 = lo + g + w2 / 2, hi - g - w2 / 2
                    ok = all(all(c + w2 / 2 <= bl - 0.5 + EPS or c - w2 / 2 >= bh + 0.5 - EPS for bl, bh in blocked) for c in (c1, c2))
                    if ok:
                        placed = [(_snap(c1, 0.25), w2), (_snap(c2, 0.25), w2)]
            if not placed and r.type == "passage" and length >= PASSAGE_WINDOW_SPACING_FT + 2:
                # a long corridor wall is lit by a row of small windows, not left blank
                n = min(4, int(length // PASSAGE_WINDOW_SPACING_FT))
                wp = _floor_to(min(3.0, base + 0.5))
                gp = (length - n * wp) / (n + 1)
                if n >= 2 and gp >= WINDOW_PIER_FT:
                    placed = [(_snap(lo + gp * (i + 1) + wp * (i + 0.5), 0.25), wp) for i in range(n)]
                    placed = [(c, wd) for c, wd in placed if all(c + wd / 2 <= bl - 0.5 + EPS or c - wd / 2 >= bh + 0.5 - EPS for bl, bh in blocked)]
            if not placed:
                width = min(base, length * WINDOW_MAX_SHARE, length - 2 * WINDOW_PIER_FT)
                if width < 2.0 - EPS:
                    width = min(base, length - 2.0)             # a short wall: keep the old, tighter piers
                if width < 2.0 - EPS:
                    continue
                width = _snap(_floor_to(width) if width >= 3.0 else width, 0.5)
                c = _free_centre(lo, hi, width, blocked, WINDOW_PIER_FT)
                if c is None:
                    c = _free_centre(lo, hi, width, blocked)
                while c is None and width > 2.5:
                    width -= 0.5
                    c = _free_centre(lo, hi, width, blocked)
                if c is None:
                    continue
                placed = [(c, width)]
            for c, width in placed:
                p1, p2 = _segment(wall, c, width)
                wins.append(Window(r.id, p1, p2, width, side, sill=sill, height=round(WINDOW_HEAD - sill, 2)))
                count += 1
    return wins
