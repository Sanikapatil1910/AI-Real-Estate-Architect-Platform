"""Room program: what must be built on each floor."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from backend.planner.architect.site import PARKING_BAY_L, PARKING_BAY_W
from backend.planner.architect.rules import (
    BEDROOM_TYPES, DISPLAY, REQUESTABLE, rule_for,
)

FLOOR_NAMES = {
    "Ground": ["Ground Floor"],
    "G+1": ["Ground Floor", "First Floor"],
    "Duplex": ["Ground Floor", "First Floor"],
    "G+2": ["Ground Floor", "First Floor", "Second Floor"],
    "Villa": ["Ground Floor", "First Floor", "Second Floor"],
}

# Sizing intent -> multiplier on each room's preferred area.
INTENT_SCALE = {
    "space_efficient": 0.92,
    "balanced": 1.00,
    "comfort": 1.10,
    "luxury": 1.22,
}


@dataclass
class RoomSpec:
    id: str
    type: str
    name: str
    floor: int
    target: float                      # target area, sq ft
    attached_to: Optional[str] = None  # parent bedroom id (attached bathroom)
    role: str = ""                     # staircase: "ground" / "arrival"

    @property
    def rule(self):
        return rule_for(self.type)


@dataclass
class FloorProgram:
    index: int
    name: str
    specs: List[RoomSpec] = field(default_factory=list)
    stair: Optional[RoomSpec] = None

    def all_specs(self) -> List[RoomSpec]:
        return self.specs + ([self.stair] if self.stair else [])


@dataclass
class Program:
    building_type: str
    floors: List[FloorProgram]
    stair_dims: Optional[tuple]        # (short, long) of the stair room
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    counts: Dict[str, int] = field(default_factory=dict)
    stair_info: Optional[dict] = None


def stair_dimensions(floor_height: float = 10.0, stair_width: float = 3.5, compact: bool = False):
    """Dog-leg stair room (short, long) in feet from the stair rules.

    short = two flights side by side; long = 1 m foot landing + the longer flight + the half landing.
    """
    from backend.planner.staircase_engine import calculate_staircase
    if compact:                       # code-minimum proportions (riser 175 mm, tread 250 mm): only used when the plot needs it, and reported
        info = calculate_staircase(floor_height=floor_height, stair_width=stair_width, max_riser_mm=175.0, tread_mm=250.0)
    else:
        info = calculate_staircase(floor_height=floor_height, stair_width=stair_width)
    W = info["stair_width_feet"]
    run = max(f["run_feet"] for f in info["flights"])
    short = -(-(2 * W + 0.3) * 2 // 1) / 2                              # two lanes + handrail well, up to 0.5 ft
    long_ = -(-(info["entry_landing_feet"] + run + info["landing"]["depth_feet"]) * 2 // 1) / 2
    return max(7.0, short), max(10.0, long_), info


def _count(rooms) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for r in rooms:
        t = r.get("room_type") if isinstance(r, dict) else str(r)
        out[t] = out.get(t, 0) + 1
    return out


def build_program(rooms, building_type="Ground", family_context=None,
                  balcony_required=False, floor_height=10.0, stair_width=3.5,
                  intent="balanced", ground_toilet=True, separate_toilet=False, exact=False,
                  parking=None, floor_rooms=None, ground_bedroom=None, compact_stair=False) -> Program:
    """Turn a requested room list into per-floor RoomSpecs.

    Replaces the legacy allocator: bathrooms are matched to bedrooms per floor,
    the staircase appears on every floor at one place, and nothing is dropped.

    The room counts are EXACT: nothing is added that was not asked for (no extra common bathroom, no filler lounge) and nothing is
    dropped.  `floor_rooms` (the rooms wanted on each floor) is honoured literally, floor by floor.
    """
    if building_type not in FLOOR_NAMES:
        raise ValueError(f"Unsupported building type: {building_type}")
    names = FLOOR_NAMES[building_type]
    nfloors = len(names)
    scale = INTENT_SCALE.get(intent, 1.0)
    ctx = family_context or {}
    prog = Program(building_type, [FloorProgram(i, n) for i, n in enumerate(names)], None)
    if floor_rooms:                       # the per-floor lists are the brief: the flat room list is only their sum
        lists = floor_lists(floor_rooms, nfloors)
        rooms = [{"room_type": t} for lst in lists for t in lst]
    counts = _count(rooms)
    prog.counts = dict(counts)

    unknown = [t for t in counts if t not in REQUESTABLE]
    if unknown:
        prog.errors.append("Unsupported room type(s): " + ", ".join(sorted(unknown)))
        return prog

    def spec(rtype, floor, name=None, ident=None, attached=None, scale_=None):
        rule = rule_for(rtype)
        tgt = rule.pref_a * (scale if scale_ is None else scale_)
        tgt = min(max(tgt, rule.min_a * 1.04), rule.max_a * 0.97)
        return RoomSpec(ident or rtype, rtype, name or DISPLAY[rtype], floor, tgt, attached)

    ground = prog.floors[0]

    if floor_rooms:
        _rooms_from_floor_lists(prog, floor_rooms, spec, separate_toilet)
    else:
        # --- shared / public rooms are always on the ground floor -------------
        for rtype in ("living_room", "dining", "kitchen", "utility", "puja_room",
                      "study", "family_lounge"):
            for i in range(counts.get(rtype, 0)):
                ident = rtype if i == 0 else f"{rtype}_{i + 1}"
                nm = DISPLAY[rtype] + ("" if i == 0 else f" {i + 1}")
                floor = 0
                if rtype in ("study", "family_lounge") and nfloors > 1:
                    floor = 1                       # upstairs by default
                sp_ = spec(rtype, floor, nm, ident)
                if rtype == "kitchen" and not counts.get("dining"):
                    # no dining room asked for: the kitchen takes the space (eat-in kitchen)
                    sp_.target = min(sp_.target * 1.6, rule_for("kitchen").max_a * 0.97)
                prog.floors[floor].specs.append(sp_)

        # --- bedrooms -----------------------------------------------------------
        n_master = counts.get("master_bedroom", 0)
        n_bed = counts.get("bedroom", 0)
        n_guest = counts.get("guest_bedroom", 0)
        if n_master > 1:
            prog.warnings.append("More than one master bedroom requested; extras are planned as bedrooms.")
            n_bed += n_master - 1
            n_master = 1
        if n_master == 0 and (n_bed + n_guest) > 0:
            # a residential plan needs a master bedroom: promote one bedroom
            if n_bed:
                n_bed -= 1
            else:
                n_guest -= 1
            n_master = 1
            prog.warnings.append("No master bedroom was requested; one bedroom is planned as the master.")

        elderly_down = bool(int(ctx.get("elderly", 0) or 0) > 0 or ctx.get("ground_floor_master_required"))

        bedrooms: List[RoomSpec] = []
        if n_master:
            bedrooms.append(spec("master_bedroom", 0, "Master Bedroom", "master_bedroom"))
        for i in range(n_bed):
            bedrooms.append(spec("bedroom", 0, f"Bedroom {i + 2}", f"bedroom_{i + 2}"))
        guests = []
        for i in range(n_guest):
            guests.append(spec("guest_bedroom", 0, "Guest Bedroom" + (f" {i + 1}" if n_guest > 1 else ""),
                               f"guest_bedroom_{i + 1}" if n_guest > 1 else "guest_bedroom"))

        # floor placement
        if nfloors == 1:
            for b in bedrooms + guests:
                b.floor = 0
        else:
            upper = list(range(1, nfloors))
            for g in guests:
                g.floor = 0
            rest = list(bedrooms)
            if elderly_down and rest and rest[0].type == "master_bedroom":
                rest[0].floor = 0
                rest = rest[1:]
            elif ground_bedroom is not False and (ground_bedroom or (len(bedrooms) + len(guests) >= 3 and not guests and len(rest) >= 3)):
                # a real house keeps one bedroom downstairs (elders, guests, a bad knee).  `ground_bedroom=False` (a search variant used when the
                # ground floor is too small for it) puts every bedroom upstairs instead.
                ground_bed = next((b for b in reversed(rest) if b.type == "bedroom"), None)
                if ground_bed is not None:
                    ground_bed.floor = 0
                    rest.remove(ground_bed)
            # distribute remaining bedrooms over upper floors, filling lower first
            per = -(-len(rest) // len(upper)) if rest else 0
            for k, b in enumerate(rest):
                b.floor = upper[min(k // max(per, 1), len(upper) - 1)]
        for b in bedrooms + guests:
            prog.floors[b.floor].specs.append(b)

        # --- bathrooms: attached first; ONE COMMON bathroom on the entry floor is compulsory -------------
        n_req = counts.get("bathroom", 0)
        all_beds = bedrooms + guests
        attach_order = sorted(
            all_beds,
            key=lambda b: (0 if b.type == "master_bedroom" else 1 if b.type == "guest_bedroom" else 2, b.floor, b.id),
        )
        baths: List[RoomSpec] = []
        extra_common = False
        if n_req >= len(all_beds):
            attached_for = attach_order
            commons = n_req - len(all_beds)               # exactly the bathrooms asked for: no shared one is added on top
        else:
            attached_for = attach_order[:max(0, n_req - 1)]
            commons = n_req - len(attached_for)
        bidx = 2
        for b in attached_for:
            if b.type == "master_bedroom":
                nm, ident = "Master Bath", "bath_master"
            else:
                nm, ident = f"Bath {bidx}", f"bath_{bidx}"
                bidx += 1
            sp = spec("bathroom", b.floor, nm, ident, attached=b.id)
            baths.append(sp)
        # the first common bathroom is always on the ground floor (visitors, kitchen, living room);
        # further ones go to floors whose bedrooms have no bath of their own
        attached_ids = {s.attached_to for s in baths}
        unattached_floors = sorted({b.floor for b in all_beds if b.id not in attached_ids and b.floor > 0}, reverse=True)
        common_floors = [0] if commons > 0 else []
        for f in unattached_floors:
            if len(common_floors) < commons:
                common_floors.append(f)
        while len(common_floors) < commons:
            common_floors.append(0 if nfloors == 1 else min(1, nfloors - 1))
        for k, f in enumerate(common_floors):
            nm = "Common Bath" if commons == 1 else f"Common Bath {k + 1}"
            baths.append(spec("bathroom", f, nm, f"bath_common_{k + 1}"))
        if separate_toilet:
            # toilet (WC) and bathroom as two rooms: a WC next to the bath on the entry floor
            baths.append(spec("toilet", 0, "Common Toilet (WC)", "toilet_common"))
        for sp in baths:
            prog.floors[sp.floor].specs.append(sp)
        if extra_common:
            prog.warnings.append(
                "A common bathroom was added on the ground floor for visitors and the kitchen/living area "
                "(it is in addition to the bathrooms you asked for).")
        up_no_bath = [b for b in all_beds if b.floor > 0 and b.id not in attached_ids
                      and not any(sp.floor == b.floor for sp in baths)]
        if up_no_bath:
            prog.warnings.append("Some upstairs bedrooms have no bathroom on their floor; add a bathroom to fix this.")
        if n_req and n_req < len(all_beds):
            prog.warnings.append(
                f"{n_req} bathroom(s) for {len(all_beds)} bedrooms: {len(attached_for)} attached, the rest are shared."
            )

    # --- staircase on every floor, same footprint ---------------------------
    if nfloors > 1:
        short, long_, info = stair_dimensions(floor_height, stair_width, compact=compact_stair)
        prog.stair_dims = (short, long_)
        prog.stair_info = info
        for n_ in info.get("notes", []):
            prog.warnings.append(n_)
        for fp in prog.floors:
            st = RoomSpec("staircase", "staircase", "Staircase", fp.index,
                          short * long_, role="ground" if fp.index == 0 else "arrival")
            fp.stair = st

    # --- parking: a covered porch built into the ground floor, touching the road ---------------------
    if parking and (parking[0] or parking[1]):
        cars, bikes = parking
        if cars:
            tgt = PARKING_BAY_W * PARKING_BAY_L * cars + (50.0 if bikes else 0.0)
            role = f"cars{cars}" + ("+bikes" if bikes else "")
            ground.specs.append(RoomSpec("parking", "parking", "Car Parking", 0, tgt, role=role))
        else:
            ground.specs.append(RoomSpec("bike_parking", "bike_parking", "Bike Parking", 0,
                                         max(55.0, 28.0 * bikes), role=f"bikes{bikes}"))

    # --- balconies on upper floors ------------------------------------------
    if balcony_required:
        if nfloors == 1:
            prog.warnings.append("Balcony requested for a single-storey house: planned as a front sit-out outside the footprint.")
        for fp in prog.floors[1:]:
            host = [s for s in fp.specs if s.type in BEDROOM_TYPES or s.type == "family_lounge"]
            if host:
                fp.specs.append(spec("balcony", fp.index, "Balcony", f"balcony_{fp.index}"))
            else:
                prog.warnings.append(f"{fp.name} has no bedroom or lounge to open onto a balcony, so none was planned there.")

    # --- fixed ordering, ids unique ------------------------------------------
    for fp in prog.floors:
        seen = set()
        for s in fp.specs:
            if s.id in seen:
                s.id = f"{s.id}_f{fp.index}"
            seen.add(s.id)
    return prog


_PER_FLOOR_TYPES = ("living_room", "dining", "kitchen", "utility", "puja_room", "study", "family_lounge",
                    "master_bedroom", "bedroom", "guest_bedroom", "bathroom")


def floor_lists(floor_rooms, nfloors: int) -> List[List[str]]:
    """The rooms wanted on each floor, as lists of room types (a list per floor, ground first)."""
    if len(floor_rooms) != nfloors:
        raise ValueError(f"floor_rooms lists {len(floor_rooms)} floor(s) but the building has {nfloors}")
    out: List[List[str]] = []
    for lst in floor_rooms:
        out.append([x.get("room_type") if isinstance(x, dict) else str(x) for x in (lst or [])])
    return out


def _rooms_from_floor_lists(prog: Program, floor_rooms, spec, separate_toilet: bool = False) -> None:
    """Build the rooms exactly as listed floor by floor (no room is moved, added or dropped).

    A bathroom listed on a floor is attached to a bedroom of that floor (the master first) while there are bedrooms without one;
    any further bathroom listed there is a common bathroom of that floor.  A floor with no bedroom gets only common bathrooms."""
    wants = floor_lists(floor_rooms, len(prog.floors))
    seen: Dict[str, int] = {}
    n_master_total = sum(w.count("master_bedroom") for w in wants)
    n_bed_total = sum(w.count("bedroom") for w in wants)
    promote = n_master_total == 0 and n_bed_total > 0          # a residential plan needs a master bedroom: the first bedroom becomes it
    if n_master_total > 1:
        prog.warnings.append("More than one master bedroom was listed; the extra ones are planned as bedrooms.")
    bed_no = 1
    master_done = False
    bath_no = 1
    for fi, want in enumerate(wants):
        beds: List[RoomSpec] = []
        for t in want:
            if t == "bathroom":
                continue
            seen[t] = seen.get(t, 0) + 1
            n = seen[t]
            if t in ("master_bedroom", "bedroom"):
                as_master = (t == "master_bedroom" and not master_done) or (promote and not master_done)
                if as_master:
                    master_done = True
                    sp = spec("master_bedroom", fi, "Master Bedroom", "master_bedroom")
                else:
                    bed_no += 1
                    sp = spec("bedroom", fi, f"Bedroom {bed_no}", f"bedroom_{bed_no}")
                beds.append(sp)
            elif t == "guest_bedroom":
                sp = spec("guest_bedroom", fi, "Guest Bedroom" + (f" {n}" if n > 1 else ""), "guest_bedroom" if n == 1 else f"guest_bedroom_{n}")
                beds.append(sp)
            else:
                ident = t if n == 1 else f"{t}_{n}"
                nm = DISPLAY[t] + ("" if n == 1 else f" {n}")
                sp = spec(t, fi, nm, ident)
                if t == "kitchen" and not any("dining" in w for w in wants):
                    sp.target = min(sp.target * 1.6, rule_for("kitchen").max_a * 0.97)
            prog.floors[fi].specs.append(sp)
        n_baths = want.count("bathroom")
        order = sorted(beds, key=lambda b: (0 if b.type == "master_bedroom" else 1 if b.type == "guest_bedroom" else 2, b.id))
        for k in range(n_baths):
            if k < len(order):
                b = order[k]
                if b.type == "master_bedroom":
                    nm, ident = "Master Bath", "bath_master"
                else:
                    bath_no += 1
                    nm, ident = f"Bath {bath_no}", f"bath_{bath_no}"
                prog.floors[fi].specs.append(spec("bathroom", fi, nm, ident, attached=b.id))
            else:
                c = k - len(order) + 1
                prog.floors[fi].specs.append(spec("bathroom", fi, "Common Bath" if c == 1 and fi == 0 else f"Common Bath F{fi}" + (f"-{c}" if c > 1 else ""),
                                                  f"bath_common_f{fi}_{c}"))
        if beds and n_baths < len(beds):
            prog.warnings.append(f"{prog.floors[fi].name}: {len(beds)} bedroom(s) and {n_baths} bathroom(s) listed, so "
                                 f"{len(beds) - n_baths} bedroom(s) share a bathroom.")
    if separate_toilet:
        prog.floors[0].specs.append(spec("toilet", 0, "Common Toilet (WC)", "toilet_common"))
