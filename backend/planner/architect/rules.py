"""Dimension rules, zoning preferences and door-connection rules."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Dict, Optional

from backend.planner.room_rules import ROOM_RULES

EPS = 1e-6
GRID = 0.5          # all dimensions are multiples of 6 inches

BEDROOM_TYPES = {"master_bedroom", "bedroom", "guest_bedroom"}
HABITABLE = BEDROOM_TYPES | {"living_room", "dining", "kitchen", "study", "family_lounge"}
CIRCULATION = {"passage"}
WET = {"bathroom", "toilet", "kitchen", "utility"}
WETROOM = {"bathroom", "toilet"}
PARKING_TYPES = {"parking", "bike_parking"}
# Vehicle and bay dimensions (ft), all in one place so a different market / vehicle class is a one-line change.
# A car bay is the vehicle plus the clearance needed to open its doors and to walk round it.
VEHICLE_FT = {"car": (6.0, 14.0),            # width x length of a mid-size car / compact SUV (1.83 x 4.27 m)
              "bike": (2.0, 6.0)}            # a motorcycle / scooter
BAY_CLEARANCE_FT = {"side": 1.5,             # each side of a car (door swing)
                    "end": 1.0}              # at the closed (house) end of the bay; the open end is the drive from the road
CAR_BAY_W = VEHICLE_FT["car"][0] + 2 * BAY_CLEARANCE_FT["side"]          # 9.0 ft across the frontage
CAR_BAY_L = VEHICLE_FT["car"][1] + BAY_CLEARANCE_FT["end"]               # 15.0 ft along the drive
BIKE_BAY_W = VEHICLE_FT["bike"][0]                                      # per bike; one extra foot is added to the row


def park_width(ptype: str, role: str) -> float:
    """Exact width across the frontage that the parking room is built to ("cars2", "cars1+bikes", "bikes3")."""
    if ptype == "bike_parking":
        n = int(role[5:]) if role.startswith("bikes") and role[5:].isdigit() else 2
        return BIKE_BAY_W * min(max(n, 1), 4) + 1.0
    n = int(role[4]) if role.startswith("cars") and len(role) > 4 and role[4].isdigit() else 1
    return CAR_BAY_W * n + (4.5 if role.endswith("+bikes") else 0.0)


PARK_MIN_DEPTH = {"parking": CAR_BAY_L, "bike_parking": VEHICLE_FT["bike"][1] + 2.0}     # along the drive; the porch always touches the road

# Types a user may request. Everything else (staircase, passage, balcony, ...)
# is added by the engine itself.
REQUESTABLE = {
    "living_room", "dining", "kitchen", "utility", "master_bedroom", "bedroom",
    "guest_bedroom", "bathroom", "puja_room", "study", "family_lounge",
}

DISPLAY = {
    "living_room": "Living Room", "dining": "Dining", "kitchen": "Kitchen",
    "utility": "Utility", "master_bedroom": "Master Bedroom", "bedroom": "Bedroom",
    "guest_bedroom": "Guest Bedroom", "bathroom": "Bathroom", "puja_room": "Puja", "toilet": "Toilet (WC)", "parking": "Car Parking", "bike_parking": "Bike Parking",
    "study": "Study", "family_lounge": "Family Lounge", "staircase": "Staircase",
    "passage": "Passage", "balcony": "Balcony", "open_terrace": "Open Terrace",
}


@dataclass(frozen=True)
class Rule:
    min_s: float          # minimum short side
    min_l: float          # minimum long side
    min_a: float          # minimum area
    max_a: float          # maximum area
    max_aspect: float
    max_s: float          # maximum short side
    pref_a: float         # preferred area


# Overrides on top of room_rules.ROOM_RULES (the project's rule table).
_OVERRIDES: Dict[str, dict] = {
    # habitable rooms are 1:1 to 1:1.25 (house-owner rule).  The largest sizes are practical limits, not "whatever space is left": a room
    # that would have to exceed them makes the building footprint smaller instead (the plot keeps a bigger yard), and an upper floor that the
    # rooms cannot fill leaves a plain flat roof over the floor below -- never an invented room, lounge or terrace.
    "living_room": {"max_a": 450, "max_s": 22, "max_aspect": 1.25},
    "dining": {"max_a": 260, "max_s": 16, "max_aspect": 1.25},
    # a kitchen needs room for a counter run, sink, hob, fridge and a person working: 8 x 10 ft at the least, never an oversized hall
    "kitchen": {"max_a": 200, "max_s": 15, "max_aspect": 1.25, "min_s": 8.0, "min_l": 8.0, "min_a": 80.0, "pref_a": 110},
    "master_bedroom": {"max_a": 330, "max_s": 19, "max_aspect": 1.25},
    "bedroom": {"max_a": 280, "max_s": 17, "max_aspect": 1.25},
    "guest_bedroom": {"max_a": 280, "max_s": 17, "max_aspect": 1.25},
    # a bathroom is a small wet room: fixtures (WC, basin, shower) plus movement, 5 x 7 to 8 x 10 ft.  It must stay well below any bedroom.
    "bathroom": {"max_a": 80, "max_s": 9, "max_aspect": 2.6},
    "toilet": {"max_a": 24, "max_s": 5, "max_aspect": 2.4},
    "utility": {"max_a": 70, "max_s": 8},
    "puja_room": {"max_a": 56, "max_s": 7},
    "study": {"max_a": 150, "max_s": 13, "max_aspect": 1.25},
    "family_lounge": {"max_a": 260, "max_s": 16, "max_aspect": 1.25},
    "staircase": {"min_a": 70, "max_a": 160, "max_s": 9.0, "max_aspect": 2.8, "min_l": 10.0},
    "passage": {"min_s": 3.5, "max_s": 5.5, "max_a": 330},
    "balcony": {"min_s": 4.0, "min_l": 7.0, "min_a": 30, "max_a": 68, "max_s": 5.5,
                "max_aspect": 3.2, "pref_a": 42},
    # an open terrace must stay a usable outdoor space (not a sliver left over beside a corridor)
    "open_terrace": {"min_s": 6.0, "min_a": 90, "max_s": 100.0, "max_a": 5000, "max_aspect": 4.5},
}


# "Compact" mode (fallback only): habitable rooms may be a little smaller than the
# comfortable minimums so that tight plots can still be planned.  The factor is process-wide;
# service.generate holds a lock while it is not 1.0.
_COMPACT = {"f": 1.0}
_SCALED = {"living_room", "dining", "kitchen", "master_bedroom", "bedroom", "guest_bedroom",
           "study", "family_lounge", "puja_room", "utility"}
# Strict mode: plan exactly what was asked - no filler rooms, no invented passages, no relaxation.
STRICT = {"on": True, "passage_ok": False, "bath_ext": True, "util_corner": True, "max_pass": 2, "aspect": 1.25, "pass_cap": True, "pass_cap_hold": True}  # passage_ok: a passage may be used because rooms could not be reached without one


# A bathroom must stay clearly smaller than the bedroom it serves (and than any bedroom of the house).
BATH_MAX_SHARE_OF_PARENT = 0.60       # an attached bathroom: at most 60 % of the area of its bedroom
BATH_MAX_SHARE_OF_SMALLEST_BED = 0.70  # any bathroom: at most this share of the smallest bedroom of the building


# Hard floor for "compact" planning: (shortest side ft, area sq ft).  Compact mode may squeeze rooms below the comfortable minimums above,
# but never below these code-type minimums (roughly the National Building Code of India residential minimums: a habitable room 9.5 m2 /
# 2.4 m wide, further habitable rooms 7.5 m2 / 2.1 m, a kitchen 4.5 m2 / 1.5 m).  Reported to the user whenever it is used.
HARD_MIN = {
    "living_room": (8.0, 102.0), "master_bedroom": (8.0, 102.0), "bedroom": (7.0, 81.0), "guest_bedroom": (7.0, 81.0),
    "dining": (7.0, 81.0), "family_lounge": (7.0, 81.0), "study": (6.0, 54.0), "kitchen": (7.0, 63.0),
    "utility": (3.5, 20.0), "puja_room": (3.0, 12.0),
}


_ASPECT_TYPES = ("living_room", "dining", "kitchen", "master_bedroom", "bedroom", "guest_bedroom", "study", "family_lounge")


def set_aspect(a: float) -> None:
    """Habitable rooms are 1:1 .. 1:a.  1.25 is the rule; the search only widens it as a last resort."""
    if abs(STRICT.get("aspect", 1.25) - a) < 1e-9 and _OVERRIDES["bedroom"].get("max_aspect") == a:
        return
    STRICT["aspect"] = a
    for t in _ASPECT_TYPES:
        _OVERRIDES[t]["max_aspect"] = a
    rule_for.cache_clear()
    for fn in _CACHE_HOOKS:
        fn.cache_clear()


def set_strict(on: bool) -> None:
    STRICT["on"] = bool(on)
    STRICT["passage_ok"] = False
    STRICT["bath_ext"] = True
    STRICT["util_corner"] = True
    STRICT["max_pass"] = 2
    STRICT["pass_cap"] = True
    set_aspect(1.25)


_CACHE_HOOKS = []          # functions whose caches depend on rule_for


def set_compact(f: float) -> None:
    if abs(_COMPACT["f"] - f) < 1e-9:
        return
    _COMPACT["f"] = f
    rule_for.cache_clear()
    for fn in _CACHE_HOOKS:
        fn.cache_clear()


def _q(x: float) -> float:
    """Round up to the 0.5 ft grid."""
    import math
    return math.ceil(x * 2 - 1e-9) / 2


@lru_cache(maxsize=None)
def rule_for(room_type: str) -> Rule:
    base = ROOM_RULES[room_type]
    o = _OVERRIDES.get(room_type, {})
    k = _COMPACT["f"] if room_type in _SCALED else 1.0
    if k != 1.0:
        o = dict(o)
        hs, ha = HARD_MIN.get(room_type, (0.0, 0.0))
        o["min_s"] = max(_q(float(o.get("min_s", base["min_width"])) * k), hs)          # compaction never goes below the code minimum
        o["min_l"] = max(_q(float(o.get("min_l", base["min_length"])) * k), o["min_s"])
        o["min_a"] = max(float(o.get("min_a", base["min_area"])) * k * k, ha)
    return Rule(
        min_s=float(o.get("min_s", base["min_width"])),
        min_l=float(o.get("min_l", base["min_length"])),
        min_a=float(o.get("min_a", base["min_area"])),
        max_a=float(o.get("max_a", base["max_area"])),
        max_aspect=float(o.get("max_aspect", base["max_aspect_ratio"])),
        max_s=float(o.get("max_s", 40.0)),
        pref_a=float(o.get("pref_a", base["preferred_area"])),
    )


def room_ok(rule: Rule, w: float, e: float) -> bool:
    """True when a w x e rectangle satisfies the rule (orientation-free)."""
    s, l = (w, e) if w <= e else (e, w)
    if s < rule.min_s - EPS or l < rule.min_l - EPS:
        return False
    a = w * e
    if a < rule.min_a - EPS or a > rule.max_a + EPS:
        return False
    if s > rule.max_s + EPS:
        return False
    if l / s > rule.max_aspect + EPS:
        return False
    return True


# --------------------------------------------------------------------------
# Zoning: preferred position along the plot depth, 0 = road side, 1 = rear.
# --------------------------------------------------------------------------
DEPTH_PREF = {
    "living_room": 0.12, "dining": 0.40, "kitchen": 0.62, "utility": 0.78,
    "puja_room": 0.35, "master_bedroom": 0.86, "bedroom": 0.80,
    "guest_bedroom": 0.20, "study": 0.30, "family_lounge": 0.50,
    "bathroom": 0.62, "toilet": 0.62, "parking": 0.0, "bike_parking": 0.0, "staircase": 0.45, "passage": 0.5, "balcony": 0.10,
    "open_terrace": 0.5,
}

# --------------------------------------------------------------------------
# Door rules.  (a, b) -> allowed.  Attached bathrooms are handled separately.
# --------------------------------------------------------------------------
_ALLOWED = {
    "living_room": {"parking", "bike_parking", "open_terrace", "dining", "passage", "family_lounge", "staircase", "puja_room",
                    "study", "guest_bedroom", "balcony", "bedroom", "master_bedroom", "bathroom", "toilet"},
    "dining": {"parking", "open_terrace", "living_room", "kitchen", "passage", "staircase", "puja_room",
               "family_lounge", "bathroom", "toilet"},
    "kitchen": {"dining", "utility", "passage"},
    "utility": {"kitchen", "passage"},
    "puja_room": {"living_room", "dining", "passage", "family_lounge"},
    "study": {"passage", "living_room", "family_lounge"},
    "family_lounge": {"open_terrace", "passage", "living_room", "dining", "staircase", "bedroom",
                      "master_bedroom", "guest_bedroom", "study", "puja_room",
                      "balcony", "bathroom", "toilet"},
    "staircase": {"parking", "open_terrace", "living_room", "dining", "passage", "family_lounge", "bedroom",
                  "master_bedroom", "guest_bedroom"},      # landing lobby upstairs
    "passage": {"parking", "bike_parking", "open_terrace", "living_room", "dining", "kitchen", "utility", "puja_room", "study",
                "family_lounge", "staircase", "bedroom", "master_bedroom",
                "guest_bedroom", "bathroom", "toilet", "passage"},       # a passage branches off a corridor (T junction)
    "master_bedroom": {"open_terrace", "passage", "family_lounge", "balcony", "staircase", "living_room"},
    "bedroom": {"open_terrace", "passage", "family_lounge", "balcony", "staircase", "living_room"},
    "guest_bedroom": {"open_terrace", "passage", "family_lounge", "living_room", "balcony", "staircase"},
    "bathroom": {"passage", "family_lounge", "staircase", "living_room", "dining", "toilet"},          # common bathrooms
    "toilet": {"passage", "family_lounge", "staircase", "living_room", "dining", "bathroom"},
    "parking": {"living_room", "dining", "passage", "staircase"},          # porch door into the house
    "bike_parking": {"living_room", "passage"},
    "open_terrace": {"family_lounge", "passage", "staircase", "bedroom", "master_bedroom",
                     "guest_bedroom", "living_room", "dining"},
    # a balcony is entered from a room (bedroom / lounge), never from a corridor
    "balcony": {"bedroom", "master_bedroom", "guest_bedroom", "family_lounge", "living_room"},
}


def door_allowed(type_a: str, type_b: str) -> bool:
    return type_b in _ALLOWED.get(type_a, set()) and type_a in _ALLOWED.get(type_b, set())


# Door-type labels understood by the legacy renderers.
def door_label(type_a: str, type_b: str) -> str:
    pair = {type_a, type_b}
    if pair & WETROOM:
        return "bathroom"
    if pair & BEDROOM_TYPES:
        return "bedroom"
    if "puja_room" in pair:
        return "puja_room"
    if "utility" in pair:
        return "utility"
    return "internal"


DOOR_WIDTH = {"main": 4.0, "bathroom": 2.5, "bedroom": 3.0, "puja_room": 2.5,
              "utility": 2.5, "internal": 3.0, "arch": 4.0}

WINDOW_WIDTH = {
    "living_room": 6.0, "dining": 4.5, "kitchen": 4.0, "master_bedroom": 6.0,
    "bedroom": 5.0, "guest_bedroom": 5.0, "bathroom": 2.0, "utility": 3.0,
    "puja_room": 2.0, "toilet": 1.5, "parking": 0.0, "bike_parking": 0.0, "study": 4.5, "family_lounge": 6.0, "passage": 2.5,
    "staircase": 3.0, "balcony": 0.0, "open_terrace": 0.0, "courtyard": 0.0,
}
# Sill height (ft above the floor) by room type. Habitable rooms get a low sill and a tall opening (head at 7 ft, the door height);
# bathrooms and toilets get a high ventilator for privacy; kitchens and utility rooms sit above the counter.
WINDOW_SILL = {
    "living_room": 2.0, "family_lounge": 2.0, "master_bedroom": 2.5, "bedroom": 2.5, "guest_bedroom": 2.5, "study": 2.5, "dining": 2.5,
    "kitchen": 3.0, "utility": 3.5, "puja_room": 3.0, "passage": 3.0, "staircase": 3.0, "bathroom": 5.0, "toilet": 5.0,
}
# A corridor wall longer than this gets one small window per this many feet (never a long blank wall)
PASSAGE_WINDOW_SPACING_FT = 10.0
WINDOW_HEAD = 7.0                # top of every window (same as the doors)
WINDOW_PIER_FT = 1.25            # solid wall kept between a window and a corner (or the next window)
WINDOW_MAX_SHARE = 0.62          # a window takes at most this share of its wall
TWO_WINDOW_WALL_FT = 14.0        # a habitable room's wall at least this long gets two windows instead of one wide one
HABITABLE_WINDOW_TYPES = frozenset({"living_room", "family_lounge", "master_bedroom", "bedroom", "guest_bedroom", "study"})
WINDOW_DEFAULT_SILL = 3.0


# ---- envelope: roof overhang and balcony projection (all feet; both are requests-configurable) ---------------------------------------
ROOF_OVERHANG_FT = 1.5               # how far a flat roof slab projects beyond the wall face (about 450 mm)
ROOF_OVERHANG_LIMITS = (0.5, 3.0)
ROOF_PLOT_CLEAR_FT = 1.0             # a roof edge never comes closer than this to the plot boundary
BALCONY_PROJECTION_FT = 3.0          # how far an upper-floor balcony may project beyond the enclosed floor (cantilever)
BALCONY_PROJECTION_LIMITS = (0.0, 4.0)
BALCONY_PLOT_CLEAR_FT = 2.0          # a balcony edge never comes closer than this to the plot boundary (the setback allowance is what is left)
BALCONY_MIN_PROJECTION_FT = 1.0      # below this it is not worth a cantilever slab: the balcony stays inside the footprint
BALCONY_PORCH_CLEAR_FT = 1.5         # no projection over the main entrance or a car porch (keeps clear of the entrance canopy)


# ---- facade: chajja (sun-shade slab projecting over every window) -----------------------------------------------------------------
CHAJJA_PROJECTION_FT = 1.5       # how far the slab projects from the wall face (450 mm)
CHAJJA_THICKNESS_FT = 0.33       # slab thickness (100 mm)
CHAJJA_SIDE_OVERHANG_FT = 0.5    # extends this far past each jamb of the window
CHAJJA_LIMITS = {"projection": (0.75, 3.0), "thickness": (0.2, 0.75)}
