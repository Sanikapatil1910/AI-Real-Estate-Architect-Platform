"""The immutable requirement specification and the requirement ledger.

`build_spec(payload)` freezes what the user asked for -- floors, rooms (in total and, when given, per floor), parking, terrace, balcony,
garden, plot frontage and depth, setbacks -- before any plan is generated.  Nothing in the planner may change it: every generated candidate is
checked AGAINST it (`violations`), and the same frozen object is used for the final report (`ledger`).

The checks read the plan's own rooms, so they cannot be fooled by labels: a room counts only if its rectangle is in the geometry.

Tier 1 (geometry: setbacks, overlap, circulation, stairs, doors) is verified by `verify.py`; this module is Tier 2, the brief itself.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from backend.planner.architect.rules import (
    BATH_MAX_SHARE_OF_PARENT, BATH_MAX_SHARE_OF_SMALLEST_BED, BEDROOM_TYPES, REQUESTABLE,
)

FLOORS_OF = {"Ground": 1, "G+1": 2, "Duplex": 2, "G+2": 3, "Villa": 3}
FLOOR_NAMES = {1: ["Ground Floor"], 2: ["Ground Floor", "First Floor"], 3: ["Ground Floor", "First Floor", "Second Floor"]}

# room types the planner adds by itself (circulation / structure), never counted as the user's rooms
STRUCTURAL = frozenset({"staircase", "passage"})
OUTDOOR = frozenset({"balcony", "open_terrace", "parking", "bike_parking", "garden"})
LABEL = {
    "living_room": "Living room", "dining": "Dining room", "kitchen": "Kitchen", "utility": "Utility", "puja_room": "Puja room",
    "study": "Study", "family_lounge": "Family lounge", "bedroom": "Bedrooms", "guest_bedroom": "Guest bedrooms", "bathroom": "Bathrooms",
    "toilet": "Separate toilet (WC)", "balcony": "Balcony", "open_terrace": "Open terrace", "parking": "Car parking", "bike_parking": "Bike parking",
}
# Kitchen: the least that holds a counter run, sink, hob, fridge and a person at work (ft, sq ft)
KITCHEN_MIN_SHORT = 7.0
KITCHEN_MIN_AREA = 63.0


def _group(t: str) -> str:
    """The ledger counts a master bedroom and a bedroom as bedrooms (the master is one of them)."""
    return "bedroom" if t in ("master_bedroom", "bedroom") else t


def _floor_lists(payload: Dict[str, Any], n_floors: int) -> Optional[List[List[str]]]:
    fr = payload.get("floor_rooms")
    if not fr:
        return None
    if len(fr) != n_floors:
        raise ValueError(f"floor_rooms lists {len(fr)} floor(s) but the building type has {n_floors}")
    return [[x.get("room_type") if isinstance(x, dict) else str(x) for x in (lst or [])] for lst in fr]


def _tuple_counts(types: Iterable[str]) -> Tuple[Tuple[str, int], ...]:
    out: Dict[str, int] = {}
    for t in types:
        g = _group(t)
        out[g] = out.get(g, 0) + 1
    return tuple(sorted(out.items()))


@dataclass(frozen=True)
class Spec:
    building_type: str
    floors: int
    floor_names: Tuple[str, ...]
    counts: Tuple[Tuple[str, int], ...]                         # exact number of each requested room type (master + bedroom = bedroom)
    per_floor: Optional[Tuple[Tuple[Tuple[str, int], ...], ...]]  # exact rooms of each floor, when the user listed them
    cars: int
    bikes: int
    terrace: bool
    balcony: bool
    garden: bool
    separate_toilet: bool
    frontage: float
    depth: float
    frontage_selected: bool
    road_side: str
    plot_width: float
    plot_length: float
    setbacks: Tuple[Tuple[str, float], ...]
    strict: bool

    # ---- lookups --------------------------------------------------------------------------------------------------
    def count(self, t: str) -> int:
        return dict(self.counts).get(t, 0)

    def floor_count(self, floor: int, t: str) -> Optional[int]:
        if self.per_floor is None:
            return None
        return dict(self.per_floor[floor]).get(t, 0)

    @property
    def bedrooms(self) -> int:
        return self.count("bedroom")

    def fingerprint(self) -> str:
        return hashlib.sha1(json.dumps(self.as_dict(), sort_keys=True, default=str).encode()).hexdigest()[:16]

    def as_dict(self) -> Dict[str, Any]:
        return {
            "building_type": self.building_type, "floors": self.floors, "floor_names": list(self.floor_names),
            "rooms": dict(self.counts),
            "per_floor": None if self.per_floor is None else [dict(f) for f in self.per_floor],
            "parking": {"cars": self.cars, "bikes": self.bikes}, "terrace": self.terrace, "balcony": self.balcony, "garden": self.garden,
            "separate_toilet": self.separate_toilet,
            "plot": {"frontage": self.frontage, "depth": self.depth, "frontage_selected": self.frontage_selected, "road_side": self.road_side,
                     "width": self.plot_width, "length": self.plot_length},
            "setbacks": dict(self.setbacks), "mode": "strict" if self.strict else "flexible",
        }


def normalise_site(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve the plot's frontage and depth explicitly.

    The user enters two plot dimensions and chooses which one faces the road (`frontage_ft`).  The other is the depth.  The plot is then laid
    out so that the frontage runs along the road side: for a North / South road the frontage is the east-west width, for an East / West road it
    is the north-south length.  Nothing is guessed from which number is larger or which was typed first.  Without `frontage_ft` (API callers
    that predate the selector) the old rule applies -- the road side decides -- and `frontage_selected` says so.  Idempotent."""
    p = dict(payload)
    W, L = float(p["plot_width"]), float(p["plot_length"])
    road = p.get("road_side", "North")
    ns = road in ("North", "South")
    fr = p.get("frontage_ft")
    if fr in (None, "", 0, 0.0):
        frontage, depth = (W, L) if ns else (L, W)
        selected = False
        entered = p.get("entered_plot") or [W, L]
    else:
        fr = float(fr)
        entered = p.get("entered_plot") or [W, L]
        e_w, e_l = float(entered[0]), float(entered[1])
        if abs(fr - e_w) < 1e-6:
            depth = e_l
        elif abs(fr - e_l) < 1e-6:
            depth = e_w
        else:
            raise ValueError(f"The frontage ({fr:g} ft) must be one of the two plot dimensions ({e_w:g} and {e_l:g} ft).")
        frontage, selected = fr, True
        if ns:
            p["plot_width"], p["plot_length"] = frontage, depth
        else:
            p["plot_length"], p["plot_width"] = frontage, depth
    p["plot_frontage"], p["plot_depth"], p["frontage_selected"] = frontage, depth, selected
    p["entered_plot"] = list(entered)
    if p.get("floor_rooms"):                          # the per-floor lists are the brief; the flat list is only their sum
        n = FLOORS_OF.get(p.get("building_type", "Ground"), 1)
        lists = _floor_lists(p, n)
        p["rooms"] = [{"room_type": t} for lst in lists for t in lst]
    return p


def build_spec(payload: Dict[str, Any]) -> Spec:
    from backend.planner.architect.site import parking_mix
    p = normalise_site(payload)
    bt = p.get("building_type", "Ground")
    if bt not in FLOORS_OF:
        raise ValueError(f"Unsupported building type: {bt}")
    n = FLOORS_OF[bt]
    lists = _floor_lists(p, n)
    if lists is not None:
        rooms = [t for lst in lists for t in lst]
    else:
        rooms = [r.get("room_type") if isinstance(r, dict) else str(r) for r in p.get("rooms", [])]
    cars, bikes = parking_mix(bool(p.get("parking_required")), p.get("parking_spaces", 1), p.get("parking_type", ""))
    sb = p.get("setbacks") or {}
    return Spec(
        building_type=bt, floors=n, floor_names=tuple(FLOOR_NAMES[n]),
        counts=_tuple_counts(rooms),
        per_floor=None if lists is None else tuple(_tuple_counts(l) for l in lists),
        cars=cars, bikes=bikes,
        terrace=bool(p.get("include_terrace", False)), balcony=bool(p.get("balcony_required")), garden=bool(p.get("garden_required")),
        separate_toilet=str(p.get("common_toilet", "attached")).lower() == "separate",
        frontage=float(p["plot_frontage"]), depth=float(p["plot_depth"]), frontage_selected=bool(p["frontage_selected"]),
        road_side=p.get("road_side", "North"), plot_width=float(p["plot_width"]), plot_length=float(p["plot_length"]),
        setbacks=tuple((k, float(sb.get(k, 0) or 0)) for k in ("front", "rear", "left", "right")),
        strict=p.get("strict", True) is not False,
    )


# ---------------------------------------------------------------------------------------------------------------------
# checking a plan against the spec
# ---------------------------------------------------------------------------------------------------------------------
def plan_counts(plan: Dict[str, Any]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for fl in plan["floors"]:
        for r in fl["layout"]["rooms"]:
            g = _group(r["room_type"])
            out[g] = out.get(g, 0) + 1
    return out


def _v(code: str, message: str, floor: Optional[str] = None, hard: bool = True) -> Dict[str, Any]:
    return {"code": code, "message": message, "floor": floor, "hard": hard}


def violations(spec: Spec, plan: Dict[str, Any], relaxed: Optional[Dict[str, int]] = None) -> List[Dict[str, Any]]:
    """Every way `plan` differs from the brief.  `relaxed` (flexible mode only) lists room counts the caller was allowed to lower; those are
    not violations of the adjusted programme but ARE reported by the compliance report as unmet."""
    out: List[Dict[str, Any]] = []
    floors = plan["floors"]
    if len(floors) != spec.floors:
        out.append(_v("FLOORS", f"{spec.building_type} means {spec.floors} floor(s); the plan has {len(floors)}."))
    got = plan_counts(plan)
    want = dict(spec.counts)
    want_t = 1 if spec.separate_toilet else 0
    allowed = dict(want)
    if relaxed is not None:
        allowed.update(relaxed)
    for t in sorted(set(allowed) | set(got)):
        if t in STRUCTURAL or t in OUTDOOR:
            continue
        if t == "toilet":
            a = want_t
        else:
            a = allowed.get(t, 0)
        g = got.get(t, 0)
        if g < a:
            out.append(_v("MISSING_ROOM", f"{LABEL.get(t, t)}: {a} requested, {g} planned."))
        elif g > a:
            out.append(_v("EXTRA_ROOM", f"{LABEL.get(t, t)}: {a} requested, {g} planned (a room that was not asked for)."))
    # open terraces are never rooms: a roof is a roof area, a terrace is the roof terrace flag
    for fl in floors:
        for r in fl["layout"]["rooms"]:
            if r["room_type"] == "open_terrace":
                out.append(_v("TERRACE_ROOM", f"{fl['floor']}: an open terrace room was generated; terraces are never added to a floor.", fl["floor"]))
    terrace = bool((plan.get("terrace") or {}).get("exists"))
    if terrace != spec.terrace:
        out.append(_v("TERRACE", "A terrace was requested but the plan has none." if spec.terrace else "No terrace was requested but the plan has one."))
    # balcony: only when requested
    n_bal = sum(1 for fl in floors for r in fl["layout"]["rooms"] if r["room_type"] == "balcony")
    if n_bal and not spec.balcony:
        out.append(_v("EXTRA_BALCONY", "A balcony was not requested but the plan has one."))
    # parking
    n_car = sum(1 for fl in floors for r in fl["layout"]["rooms"] if r["room_type"] == "parking")
    n_bike = sum(1 for fl in floors for r in fl["layout"]["rooms"] if r["room_type"] == "bike_parking")
    pk = plan.get("parking") or {}
    if spec.cars:
        if n_car != 1 or int(pk.get("cars", 0) or 0) < spec.cars or not pk.get("placed", True):
            out.append(_v("PARKING", f"{spec.cars} car(s) requested but the plan provides {int(pk.get('cars', 0) or 0) if n_car else 0}."))
    elif spec.bikes:
        if n_bike != 1:
            out.append(_v("PARKING", f"Bike parking for {spec.bikes} requested but the plan has none."))
    elif n_car or n_bike:
        out.append(_v("EXTRA_PARKING", "Parking was not requested but the plan has a parking space."))
    # per-floor requirements
    if spec.per_floor is not None:
        for i, fl in enumerate(floors[:spec.floors]):
            have: Dict[str, int] = {}
            for r in fl["layout"]["rooms"]:
                g = _group(r["room_type"])
                have[g] = have.get(g, 0) + 1
            wanted = dict(spec.per_floor[i])
            for t in sorted(set(wanted) | set(have)):
                if t in STRUCTURAL or t in OUTDOOR or t == "toilet":
                    continue
                w_, h_ = wanted.get(t, 0), have.get(t, 0)
                if relaxed is not None and t in relaxed:
                    continue
                if h_ != w_:
                    out.append(_v("WRONG_FLOOR", f"{fl['floor']}: {LABEL.get(t, t)} {w_} requested on this floor, {h_} planned.", fl["floor"]))
    # proportions: a bathroom is clearly smaller than a bedroom; a kitchen is usable
    rooms = [(fl["floor"], r) for fl in floors for r in fl["layout"]["rooms"]]
    beds = [r for _, r in rooms if r["room_type"] in BEDROOM_TYPES]
    by_id = {r["id"]: r for _, r in rooms}
    min_bed = min((r["width"] * r["length"] for r in beds), default=None)
    for fn, r in rooms:
        if r["room_type"] == "bathroom":
            a = r["width"] * r["length"]
            par = by_id.get(r.get("attached_to") or "")
            if par is not None and a > BATH_MAX_SHARE_OF_PARENT * par["width"] * par["length"] + 0.6:
                out.append(_v("BATH_SIZE", f"{fn}: {r['name']} ({a:.0f} sq ft) is larger than 60 % of its bedroom.", fn))
            elif min_bed is not None and a > BATH_MAX_SHARE_OF_SMALLEST_BED * min_bed + 0.6:
                out.append(_v("BATH_SIZE", f"{fn}: {r['name']} ({a:.0f} sq ft) is too large next to the smallest bedroom ({min_bed:.0f} sq ft).", fn))
        elif r["room_type"] == "kitchen":
            s = min(r["width"], r["length"])
            if s < KITCHEN_MIN_SHORT - 0.06 or r["width"] * r["length"] < KITCHEN_MIN_AREA - 0.5:
                out.append(_v("KITCHEN_SIZE", f"{fn}: the kitchen ({r['width']:g} x {r['length']:g} ft) is too small to work in.", fn))
    # facade: every window of every floor carries its chajja
    from backend.planner.architect.facade import chajja_problems
    for fn, msg in chajja_problems(plan):
        out.append(_v("CHAJJA", f"{fn}: {msg}.", fn))
    return out


# ---------------------------------------------------------------------------------------------------------------------
# the ledger
# ---------------------------------------------------------------------------------------------------------------------
def ledger(spec: Spec, plan: Dict[str, Any], viol: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Requested vs delivered, per room type, per floor and per room, counted from the plan's geometry."""
    viol = violations(spec, plan) if viol is None else viol
    floors = plan["floors"]
    got = plan_counts(plan)
    want = dict(spec.counts)
    types = sorted((set(want) | set(got)) - STRUCTURAL - OUTDOOR - {"toilet"})
    totals = [{"type": t, "label": LABEL.get(t, t), "required": want.get(t, 0), "actual": got.get(t, 0), "met": got.get(t, 0) == want.get(t, 0)}
              for t in types]
    per_floor = []
    for i, fl in enumerate(floors):
        have: Dict[str, int] = {}
        for r in fl["layout"]["rooms"]:
            g = _group(r["room_type"])
            have[g] = have.get(g, 0) + 1
        req = None if spec.per_floor is None or i >= spec.floors else dict(spec.per_floor[i])
        per_floor.append({"floor": fl["floor"], "index": i, "required": req, "actual": have,
                          "met": True if req is None else all(have.get(t, 0) == req.get(t, 0) for t in set(req) | {_group(x) for x in have}
                                                              if t not in STRUCTURAL and t not in OUTDOOR and t != "toilet")})
    by_id = {r["id"]: r for fl in floors for r in fl["layout"]["rooms"]}
    bad_ids = set()
    rows = []
    doors_of: Dict[str, List[str]] = {}
    for fl in floors:
        for d in fl["layout"]["openings"]["doors"]:
            if d.get("connects_to"):
                doors_of.setdefault(d["room"], []).append(d["connects_to"])
                doors_of.setdefault(d["connects_to"], []).append(d["room"])
    for fl in floors:
        for r in fl["layout"]["rooms"]:
            t = r["room_type"]
            asked = t in STRUCTURAL or t in OUTDOOR or want.get(_group(t), 0) > 0 or (t == "toilet" and spec.separate_toilet)
            rows.append({
                "id": r["id"], "type": t, "floor": fl["floor"], "width": r["width"], "length": r["length"], "area": r["area"],
                "connections": sorted(set(doors_of.get(r["id"], []))),
                "geometry_valid": r["width"] > 0 and r["length"] > 0,
                "in_brief": bool(asked),
                "required_count": want.get(_group(t), 0), "actual_count": got.get(_group(t), 0),
                "satisfies_requirement": bool(asked) and r["width"] > 0 and r["length"] > 0
                                         and (t in STRUCTURAL or t in OUTDOOR or want.get(_group(t), 0) == got.get(_group(t), 0)),
            })
    return {
        "spec": spec.as_dict(), "fingerprint": spec.fingerprint(),
        "floors": {"required": spec.floors, "actual": len(floors), "met": spec.floors == len(floors)},
        "totals": totals, "per_floor": per_floor, "rooms": rows,
        "violations": viol, "ok": not any(v["hard"] for v in viol),
    }
