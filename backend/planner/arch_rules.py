"""Architectural size rules and the room programme for the architect engine.

All dimensions are in feet. Screen convention is used everywhere in the new
engine: x grows to the East, y grows to the South, so y = 0 is the NORTH edge
of the plot (this is also how both renderers draw the plan).
"""

from collections import Counter
from math import ceil

GRID = 0.5
SPINE_W = 3.5          # clear passage width (>= 3 ft, 3.5 is comfortable)

# min_short : smallest allowed side
# min_area  : smallest allowed area
# pref      : area the planner aims for
# max_area  : above this a "larger than needed" warning is raised
# aspect    : longest side / shortest side
ARCH_RULES = {
    "living_room":    dict(min_short=10, min_area=120, pref=180, max_area=340, aspect=2.0),
    "dining":         dict(min_short=8,  min_area=80,  pref=120, max_area=220, aspect=2.0),
    "kitchen":        dict(min_short=7,  min_area=70,  pref=100, max_area=180, aspect=2.0),
    "utility":        dict(min_short=5,  min_area=30,  pref=42,  max_area=90,  aspect=2.2),
    "master_bedroom": dict(min_short=10, min_area=120, pref=160, max_area=260, aspect=1.8),
    "bedroom":        dict(min_short=9,  min_area=90,  pref=125, max_area=200, aspect=1.8),
    "guest_bedroom":  dict(min_short=9,  min_area=90,  pref=120, max_area=200, aspect=1.8),
    "bathroom":       dict(min_short=5,  min_area=32,  pref=48,  max_area=100, aspect=2.4),
    "puja_room":      dict(min_short=4,  min_area=20,  pref=32,  max_area=70,  aspect=2.0),
    "store":          dict(min_short=4,  min_area=20,  pref=30,  max_area=70,  aspect=2.4),
    "family_lounge":  dict(min_short=9,  min_area=90,  pref=140, max_area=300, aspect=2.2),
    "study":          dict(min_short=8,  min_area=64,  pref=90,  max_area=150, aspect=1.8),
    "staircase":      dict(min_short=7,  min_area=70,  pref=90,  max_area=170, aspect=2.4),
    "balcony":        dict(min_short=4,  min_area=24,  pref=50,  max_area=130, aspect=5.0),
    "sitout":         dict(min_short=4.5, min_area=36, pref=60,  max_area=140, aspect=4.5),
    "passage":        dict(min_short=3,  min_area=0,   pref=0,   max_area=1e9, aspect=1e9),
    "parking":        dict(min_short=9,  min_area=162, pref=180, max_area=1e9, aspect=3.0),
}

LABELS = {
    "living_room": "Living Room", "dining": "Dining", "kitchen": "Kitchen",
    "utility": "Utility", "master_bedroom": "Master Bedroom", "bedroom": "Bedroom",
    "guest_bedroom": "Guest Bedroom", "bathroom": "Bathroom", "puja_room": "Puja",
    "store": "Store", "family_lounge": "Family Lounge", "study": "Study",
    "staircase": "Staircase", "balcony": "Balcony", "sitout": "Sit-out",
    "passage": "Passage", "parking": "Parking",
}

HABITABLE = {"living_room", "dining", "kitchen", "master_bedroom", "bedroom",
             "guest_bedroom", "family_lounge", "study"}
BEDROOMS = {"master_bedroom", "bedroom", "guest_bedroom"}
WET = {"bathroom", "utility"}
SMALL = {"bathroom", "puja_room", "store", "utility"}

# floors for each building type (same names the rest of the app uses)
BUILDING_FLOORS = {
    "Ground": ["Ground Floor"],
    "G+1": ["Ground Floor", "First Floor"],
    "G+2": ["Ground Floor", "First Floor", "Second Floor"],
    "Duplex": ["Ground Floor", "First Floor"],
    "Villa": ["Ground Floor", "First Floor", "Second Floor"],
}


def snap(value, grid=GRID):
    return round(value / grid) * grid


def snap_up(value, grid=GRID):
    return ceil(value / grid - 1e-9) * grid


def rule(room_type):
    return ARCH_RULES.get(room_type) or ARCH_RULES["store"]


def room_cost(room_type, width, depth, spec=None):
    """Cost of giving a room these dimensions. ``None`` means not allowed."""
    r = spec or rule(room_type)
    short, long_ = min(width, depth), max(width, depth)
    area = width * depth
    if short < r["min_short"] - 1e-6 or area < r["min_area"] - 1e-6:
        return None
    if long_ / short > r["aspect"] + 1e-6:
        return None
    pref = r["pref"]
    cost = 0.0
    if pref > 0:
        cost += ((area - pref) / pref) ** 2 * 10.0
    if area > r["max_area"]:
        cost += (area / r["max_area"] - 1.0) * 25.0
    ratio = long_ / short
    if ratio > 1.5:
        cost += (ratio - 1.5) * 3.0
    return cost


def stair_dimensions(floor_height=10.0, stair_width=3.5):
    """Return (width, length) of a dog-legged stair room.

    Two flights side by side with a 0.5 ft well; the run is half the total
    treads plus a landing as wide as the flight.
    """
    stair_width = max(3.0, float(stair_width))
    risers = max(2, round(float(floor_height) * 12.0 / 6.5))
    treads_per_flight = max(1, risers // 2 - 1) + 1
    run = treads_per_flight * (10.0 / 12.0)
    width = snap_up(2 * stair_width + 0.5)
    length = snap_up(run + stair_width + 0.5)
    return max(width, 7.0), max(length, 10.5)


# --------------------------------------------------------------------------
# Programme
# --------------------------------------------------------------------------

class ProgramError(ValueError):
    pass


def _norm_family(family_context):
    fam = family_context or {}
    return {
        "elderly": int(fam.get("elderly", 0) or 0),
        "ground_master": bool(fam.get("ground_floor_master_required")),
    }


def build_program(rooms, building_type="Ground", family_context=None,
                  parking_required=False, parking_spaces=1,
                  balcony_required=False, include_terrace=True,
                  floor_height=10.0, stair_width=3.5):
    """Turn the requested room list into a per-floor programme.

    Returns a dict with:
      floors          list of floor names
      floor_rooms     list (per floor) of room spec dicts
      stair           dict(width, length) or None
      parking         dict
      requested       Counter of requested room types
      notes           human readable notes about decisions taken
    """
    if building_type not in BUILDING_FLOORS:
        raise ProgramError(f"Unsupported building type: {building_type}")
    floors = BUILDING_FLOORS[building_type]
    nf = len(floors)
    fam = _norm_family(family_context)

    counts = Counter()
    for room in rooms or []:
        rt = str(room.get("room_type", "")).strip()
        if not rt:
            continue
        if rt not in ARCH_RULES or rt in {"passage", "parking", "staircase"}:
            raise ProgramError(f"Unsupported room type: {rt}")
        counts[rt] += 1
    requested = Counter(counts)

    notes = []
    n_master = counts["master_bedroom"]
    n_bed = counts["bedroom"]
    n_guest = counts["guest_bedroom"]
    if n_master == 0 and n_bed > 0:
        n_master, n_bed = 1, n_bed - 1
        notes.append("No master bedroom was requested, so the first bedroom was made the master bedroom.")
    if n_master > 1:
        n_bed += n_master - 1
        n_master = 1
    total_beds = n_master + n_bed + n_guest
    n_bath = counts["bathroom"]
    if total_beds and n_bath < 1:
        n_bath = 1
        notes.append("At least one bathroom is always provided.")

    def spec(rt, ident, **extra):
        d = {"id": ident, "room_type": rt, "label": LABELS.get(rt, rt)}
        d.update(extra)
        return d

    # --- ground floor elderly / master placement ----------------------
    master_ground = nf == 1 or fam["elderly"] > 0 or fam["ground_master"]
    if nf > 1 and master_ground and n_master:
        notes.append("Master bedroom is on the ground floor for easy access.")

    # --- bedroom list in priority order for attached baths -------------
    beds = []
    if n_master:
        beds.append(spec("master_bedroom", "master_bedroom"))
    for i in range(n_bed):
        beds.append(spec("bedroom", f"bedroom_{i + 2}"))
    for i in range(n_guest):
        beds.append(spec("guest_bedroom", "guest_bedroom" if n_guest == 1 else f"guest_bedroom_{i + 1}"))

    # --- floors for bedrooms -------------------------------------------
    floor_of = {}
    if nf == 1:
        for b in beds:
            floor_of[b["id"]] = 0
    else:
        upper = list(range(1, nf))
        on_ground = [b for b in beds if b["room_type"] == "guest_bedroom"]
        rest = [b for b in beds if b["room_type"] != "guest_bedroom"]
        if master_ground and rest and rest[0]["room_type"] == "master_bedroom":
            on_ground.append(rest.pop(0))
        for b in on_ground:
            floor_of[b["id"]] = 0
        # spread the remaining bedrooms evenly, master first (so it is on the lowest upper floor)
        n_up = len(rest)
        base, extra = divmod(n_up, len(upper))
        idx = 0
        for k, fl in enumerate(upper):
            take = base + (1 if k < extra else 0)
            for b in rest[idx: idx + take]:
                floor_of[b["id"]] = fl
            idx += take

    # --- bathrooms -------------------------------------------------------
    ground_has_bed = any(floor_of[b["id"]] == 0 for b in beds)
    common_baths = 0
    attach_n = min(n_bath, len(beds))
    extra_baths = n_bath - attach_n
    if nf > 1 and not ground_has_bed and extra_baths == 0 and n_bath >= 2:
        # keep one toilet on the ground floor for guests
        attach_n -= 1
        extra_baths = 1
    common_baths = extra_baths
    if n_bath == 1 and len(beds) > 1:
        notes.append(f"Only 1 bathroom for {len(beds)} bedrooms - it is attached to the master bedroom. Consider adding more.")

    floor_rooms = [[] for _ in floors]
    # public rooms on ground
    gf = floor_rooms[0]
    for rt in ("living_room", "dining", "kitchen", "utility", "puja_room"):
        for i in range(counts[rt]):
            gf.append(spec(rt, rt if counts[rt] == 1 else f"{rt}_{i + 1}"))
    # study rooms on ground
    for i in range(counts["study"]):
        gf.append(spec("study", "study" if counts["study"] == 1 else f"study_{i + 1}"))
    for i in range(counts["family_lounge"]):
        fl = 1 if nf > 1 else 0
        floor_rooms[fl].append(spec("family_lounge", "family_lounge" if counts["family_lounge"] == 1 else f"family_lounge_{i + 1}", requested=True))
    for i in range(counts["store"]):
        gf.append(spec("store", "store" if counts["store"] == 1 else f"store_{i + 1}"))

    bath_no = 0
    for i, b in enumerate(beds):
        fl = floor_of[b["id"]]
        floor_rooms[fl].append(dict(b))
        if i < attach_n:
            bath_no += 1
            floor_rooms[fl].append(spec("bathroom", f"bathroom_{bath_no}",
                                        attached_to_id=b["id"], attached_to=b["room_type"]))
    # common baths: first on ground floor, others on floors with bedrooms
    bedroom_floors = sorted({floor_of[b["id"]] for b in beds if floor_of[b["id"]] > 0}) or [0]
    for i in range(common_baths):
        fl = 0 if i == 0 else bedroom_floors[(i - 1) % len(bedroom_floors)]
        bath_no += 1
        floor_rooms[fl].append(spec("bathroom", f"bathroom_{bath_no}", common=True))

    # --- stairs / terrace -----------------------------------------------
    stair = None
    if nf > 1 or include_terrace:
        w, l = stair_dimensions(floor_height, stair_width)
        stair = {"width": w, "length": l, "serves_terrace": bool(include_terrace),
                 "id": "staircase"}
        if nf == 1:
            notes.append("A staircase is added so the terrace can be reached.")

    parking = {"required": bool(parking_required), "spaces": int(parking_spaces or 1) if parking_required else 0,
               "width": 9.0, "length": 18.0}

    balcony = bool(balcony_required)
    return {
        "floors": list(floors), "floor_rooms": floor_rooms, "stair": stair,
        "parking": parking, "requested": requested, "notes": notes,
        "balcony": balcony, "include_terrace": bool(include_terrace),
        "floor_of": floor_of,
    }
