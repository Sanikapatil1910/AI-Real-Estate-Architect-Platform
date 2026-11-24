"""Hard rules and architectural scoring for one tiled floor."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Dict, List, Optional, Sequence, Set, Tuple

from backend.planner.architect.doors import OpeningPlan, plan_openings
from backend.planner.architect.geometry import Room, exterior_sides, shared_wall, tiles_exactly
from backend.planner.architect.rules import (
    BATH_MAX_SHARE_OF_PARENT, BATH_MAX_SHARE_OF_SMALLEST_BED, BEDROOM_TYPES, DEPTH_PREF, STRICT, EPS, HABITABLE, PARK_MIN_DEPTH, PARKING_TYPES, WET,
    room_ok, rule_for,
)

ZONE_NAMES = ["north_west", "north", "north_east", "west", "center", "east",
              "south_west", "south", "south_east"]


@lru_cache(maxsize=None)
def vastu_table(mode: str) -> Dict[str, Dict[str, float]]:
    """room type -> zone -> 0..1 score, from the project's Vastu rule base."""
    from backend.planner.vastu_rules import score_room_vastu
    table: Dict[str, Dict[str, float]] = {}
    pos = {"north_west": (5, 5), "north": (15, 5), "north_east": (25, 5), "west": (5, 15),
           "center": (15, 15), "east": (25, 15), "south_west": (5, 25), "south": (15, 25),
           "south_east": (25, 25)}
    types = ["living_room", "dining", "kitchen", "master_bedroom", "bedroom", "guest_bedroom",
             "bathroom", "puja_room", "utility", "staircase", "study", "family_lounge"]
    for t in types:
        table[t] = {}
        for z, (x, y) in pos.items():
            room = {"room_type": t, "x": x - 1, "y": y - 1, "width": 2, "length": 2}
            r = score_room_vastu(room, 30, 30, mode, 0, 0)
            sc = float(r.get("score", 60)) / 100.0
            if r.get("hard_constraint_violation"):
                sc = 0.0
            table[t][z] = sc
    return table


def zone_of(cx: float, cy: float, W: float, L: float) -> str:
    from backend.planner.vastu_rules import get_zone
    return get_zone(cx, cy, W, L, 0.0, 0.0)


@dataclass
class FloorEval:
    ok: bool
    reasons: List[str]
    plan: Optional[OpeningPlan] = None
    features: Dict[str, float] = field(default_factory=dict)


def _adjacent(rooms: Sequence[Room]) -> Dict[Tuple[str, str], float]:
    adj: Dict[Tuple[str, str], float] = {}
    for i in range(len(rooms)):
        for j in range(i + 1, len(rooms)):
            sw = shared_wall(rooms[i], rooms[j])
            if sw:
                adj[(rooms[i].id, rooms[j].id)] = sw["hi"] - sw["lo"]
                adj[(rooms[j].id, rooms[i].id)] = sw["hi"] - sw["lo"]
    return adj


def _park_min_width(r: Room) -> float:
    """Width the porch needs across the frontage, from its role ("cars2", "cars1+bikes", "bikes3")."""
    from backend.planner.architect.rules import park_width
    return park_width(r.type, r.role or "") - 0.01


def hard_check(rooms: List[Room], F: float, D: float, floor: int, nfloors: int) -> List[str]:
    """Rules that disqualify a layout. Empty list == passes."""
    bad: List[str] = []
    if not tiles_exactly(rooms, F, D):
        bad.append("rooms do not tile the footprint")
        return bad
    by_id = {r.id: r for r in rooms}
    for r in rooms:
        if not room_ok(rule_for(r.type), r.w, r.d):
            bad.append(f"{r.name} violates its dimension rule")
    adj = _adjacent(rooms)
    for r in rooms:
        if r.type in PARKING_TYPES:
            mw = _park_min_width(r)
            if r.v > EPS:
                bad.append(f"{r.name} must open onto the road")
            elif r.d < PARK_MIN_DEPTH[r.type] - EPS or r.w < mw - EPS:
                bad.append(f"{r.name} is too small for the vehicles")
        ext = exterior_sides(r, F, D)
        if r.type in HABITABLE and not any(l >= 3.5 for l in ext.values()):
            bad.append(f"{r.name} has no exterior wall for light and ventilation")
        if r.type == "bathroom" and r.attached_to:
            par = by_id.get(r.attached_to)
            if par is None or adj.get((r.id, par.id), 0) < 3.5:
                bad.append(f"{r.name} is not attached to its bedroom")
        if r.type in ("balcony", "open_terrace") and not ext:
            bad.append(f"{r.name} is not on an exterior wall")
        if r.type == "balcony" and ext and max(ext.values()) < max(r.w, r.d) - 0.6:
            bad.append(f"{r.name} must run along its outer wall (shallow and wide)")
        if STRICT["on"] and STRICT["bath_ext"] and r.type in ("bathroom", "toilet") and not any(l >= 3.0 for l in ext.values()):
            bad.append(f"{r.name} must touch an outer wall so its pipes and duct can be fitted")
    # a bathroom is clearly smaller than the bedroom it serves and than any bedroom on its floor
    bed_areas = [r.w * r.d for r in rooms if r.type in BEDROOM_TYPES]
    for r in rooms:
        if r.type != "bathroom":
            continue
        a_ = r.w * r.d
        par = by_id.get(r.attached_to) if r.attached_to else None
        if par is not None and a_ > BATH_MAX_SHARE_OF_PARENT * par.w * par.d + EPS:
            bad.append(f"{r.name} is larger than half of its bedroom")
        if bed_areas and a_ > BATH_MAX_SHARE_OF_SMALLEST_BED * min(bed_areas) + EPS:
            bad.append(f"{r.name} is too large next to the bedrooms")
    types = {}
    for r in rooms:
        types.setdefault(r.type, []).append(r)
    if STRICT["on"] and len(types.get("passage", [])) > STRICT["max_pass"]:
        bad.append("too many passages")
    if STRICT["on"] and STRICT.get("pass_cap", True):   # no long wasteful corridors: only a small lobby is tolerated
        ps_ = types.get("passage", [])
        if any(max(r.w, r.d) > 16.0 or r.w * r.d > 75.0 for r in ps_) or sum(r.w * r.d for r in ps_) > 110.0:
            bad.append("passage too long / large")
    # toilet and common bathroom are always side by side
    for t in types.get("toilet", []):
        cb = [b for b in types.get("bathroom", []) if not b.attached_to]
        if cb and not any(adj.get((t.id, b.id), 0) >= 3.0 for b in cb):
            bad.append("the toilet must be next to the common bathroom")
    # dining - kitchen - utility form one connected group; the utility sits in a corner of the house
    for u in (types.get("utility", []) if STRICT["on"] else []):
        ks = types.get("kitchen", [])
        if ks and not any(adj.get((u.id, k.id), 0) >= 3.0 for k in ks):
            bad.append("the utility must be attached to the kitchen")
        if len(exterior_sides(u, F, D)) < (2 if STRICT["util_corner"] else 1):
            bad.append("the utility must sit at a corner of the house")
    for k in (types.get("kitchen", []) if STRICT["on"] else []):
        ds = types.get("dining", [])
        if ds and not any(adj.get((k.id, d_.id), 0) >= 3.5 for d_ in ds):
            bad.append("the kitchen must be attached to the dining room")
    return bad


def evaluate_floor(rooms: List[Room], F: float, D: float, floor: int, nfloors: int,
                   root_id: str, extra_ok: Optional[Set[Tuple[str, str]]],
                   targets: Dict[str, float]) -> FloorEval:
    bad = hard_check(rooms, F, D, floor, nfloors)
    if bad:
        return FloorEval(False, bad)
    ground = floor == 0
    if ground:
        entry = next((r for r in rooms if r.id == root_id), None)
        if entry is None or entry.v > EPS or entry.w < 5.0:
            # a wide car porch can leave no road frontage for the living room: the entrance is then a
            # foyer passage on the road, which leads to the living room
            alt = [r for r in rooms if r.type == "passage" and r.v <= EPS and r.w >= 4.5
                   and any(p.type in PARKING_TYPES for p in rooms)]
            if not alt:
                return FloorEval(False, ["main entrance room must touch the road side"])
            root_id = alt[0].id
    plan = plan_openings(rooms, F, D, root_id, extra_ok, main_entrance=ground)
    if plan is None:
        return FloorEval(False, ["no valid door plan (some room cannot be reached)"])
    return FloorEval(True, [], plan, features(rooms, F, D, plan, targets, ground))


def features(rooms: List[Room], F: float, D: float, plan: OpeningPlan,
             targets: Dict[str, float], ground: bool) -> Dict[str, float]:
    by_id = {r.id: r for r in rooms}
    total = F * D
    # ---- zoning: depth position vs preference ------------------------------------
    num = den = 0.0
    imp = {"living_room": 3.0, "kitchen": 1.5, "master_bedroom": 2.0, "bedroom": 1.0,
           "dining": 1.0, "guest_bedroom": 1.0, "puja_room": 0.6, "utility": 0.6, "balcony": 0.8}
    for r in rooms:
        if r.type not in imp:
            continue
        if not ground and r.type in ("living_room",):
            continue
        p = r.cv / D
        pref = DEPTH_PREF[r.type]
        s = max(0.0, 1.0 - abs(p - pref) / 0.55)
        num += imp[r.type] * s; den += imp[r.type]
    zoning = num / den if den else 1.0
    # ---- adjacency/doors ----------------------------------------------------------------
    linked = {frozenset((d.a, d.b)) for d in plan.doors if d.b}
    def has(t1, t2):
        a = [r for r in rooms if r.type == t1]; b = [r for r in rooms if r.type == t2]
        if not a or not b:
            return None
        return 1.0 if any(frozenset((x.id, y.id)) in linked for x in a for y in b) else 0.0
    parts = []
    for pair, wgt in ((("living_room", "dining"), 2.0), (("dining", "kitchen"), 2.5),
                      (("kitchen", "utility"), 1.0), (("living_room", "puja_room"), 0.4)):
        v = has(*pair)
        if v is not None:
            parts.append((wgt, v))
    st = [r for r in rooms if r.type == "staircase"]
    if st:
        s = st[0]
        hub = [r for r in rooms if r.type in ("passage", "living_room", "dining", "family_lounge")]
        parts.append((1.5, 1.0 if any(frozenset((s.id, h.id)) in linked for h in hub) else 0.0))
    adjacency = sum(w * v for w, v in parts) / sum(w for w, _ in parts) if parts else 1.0
    # ---- circulation ------------------------------------------------------------------------
    pas = sum(r.area for r in rooms if r.type == "passage")
    ratio = pas / total
    if 0.04 <= ratio <= 0.12:
        circ = 1.0
    elif ratio < 0.04:
        circ = 0.75 + ratio / 0.04 * 0.25
    else:
        circ = max(0.0, 1.0 - (ratio - 0.12) / 0.12)
    maxdepth = max(plan.depth.values()) if plan.depth else 0
    circ *= 1.0 if maxdepth <= 4 else max(0.5, 1.0 - 0.15 * (maxdepth - 4))
    # ---- proportions & area fidelity -----------------------------------------------------------
    ps = []
    for r in rooms:
        if r.type in ("passage", "open_terrace") or r.type in PARKING_TYPES:
            continue
        asp = max(r.w, r.d) / min(r.w, r.d)
        a = 1.0 if asp <= 1.4 else max(0.0, 1.0 - (asp - 1.4) / 1.0)
        t = targets.get(r.id, r.area)
        dev = abs(r.area / t - 1.0)
        b = 1.0 if dev <= 0.15 else max(0.0, 1.0 - (dev - 0.15) / 0.45)
        ps.append(0.6 * a + 0.4 * b)
    proportion = sum(ps) / len(ps) if ps else 1.0
    # ---- daylight / ventilation ------------------------------------------------------------------
    hab = [r for r in rooms if r.type in HABITABLE]
    two = sum(1 for r in hab if len(exterior_sides(r, F, D)) >= 2)
    baths = [r for r in rooms if r.type in ("bathroom", "toilet")]
    bext = sum(1 for r in baths if exterior_sides(r, F, D))
    daylight = 0.65 * (two / len(hab) if hab else 1.0) + 0.35 * (bext / len(baths) if baths else 1.0)
    # ---- wet-room clustering (plumbing) -------------------------------------------------------------
    wet = [r for r in rooms if r.type in WET]
    if len(wet) > 1:
        hits = 0
        for r in wet:
            if any(o.id != r.id and o.type in WET and shared_wall(r, o) for o in wet):
                hits += 1
        service = hits / len(wet)
    else:
        service = 1.0
    # ---- privacy: bedroom doors not opening into living/dining --------------------------------------
    priv_bad = sum(1 for d in plan.doors if d.b and {by_id[d.a].type, by_id[d.b].type} & BEDROOM_TYPES
                   and {by_id[d.a].type, by_id[d.b].type} & {"living_room", "dining"})
    privacy = 1.0 if priv_bad == 0 else 0.4
    return {"zoning": zoning, "adjacency": adjacency, "circulation": circ,
            "proportion": proportion, "daylight": daylight, "service": service, "privacy": privacy}


def vastu_score(rooms: List[Room], mapper, mode: str) -> float:
    """Average Vastu preference of rooms; `mapper(room)->(cx, cy, W, L)` in real coords."""
    if mode == "no_preference":
        return 1.0
    table = vastu_table(mode)
    num = den = 0.0
    wt = {"kitchen": 2.0, "master_bedroom": 2.0, "living_room": 1.5, "puja_room": 1.5,
          "bathroom": 0.8, "staircase": 0.6, "dining": 1.0, "bedroom": 0.8, "guest_bedroom": 0.6}
    for r in rooms:
        if r.type not in table:
            continue
        cx, cy, W, L = mapper(r)
        z = zone_of(cx, cy, W, L)
        num += wt.get(r.type, 0.5) * table[r.type].get(z, 0.6)
        den += wt.get(r.type, 0.5)
    return num / den if den else 1.0
