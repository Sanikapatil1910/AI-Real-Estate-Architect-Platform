"""Independent checker: re-validates a finished plan from its real-world output only.

It does not reuse the search's own checks; it re-derives geometry from the
final room rectangles, doors and windows, so a bug in the generator or in the
coordinate conversion shows up here.
"""

from __future__ import annotations

from typing import Any, Dict, List

from backend.planner.architect.doors import LANDING_DEPTH
from backend.planner.architect.rules import BEDROOM_TYPES, HABITABLE, room_ok, rule_for

TOL = 0.06


def _edge_contact(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    """Length of wall shared by two rectangles (0 if none)."""
    if abs(a["x2"] - b["x"]) < TOL or abs(b["x2"] - a["x"]) < TOL:
        return max(0.0, min(a["y2"], b["y2"]) - max(a["y"], b["y"]))
    if abs(a["y2"] - b["y"]) < TOL or abs(b["y2"] - a["y"]) < TOL:
        return max(0.0, min(a["x2"], b["x2"]) - max(a["x"], b["x"]))
    return 0.0


def _overlap(a, b) -> bool:
    return not (a["x2"] <= b["x"] + TOL or b["x2"] <= a["x"] + TOL
                or a["y2"] <= b["y"] + TOL or b["y2"] <= a["y"] + TOL)


def verify_plan(plan: Dict[str, Any], request: Dict[str, Any]) -> Dict[str, Any]:
    """Re-check a delivered plan against the rules it was generated under (aspect widens only in 'adjust' mode)."""
    from backend.planner.architect.rules import STRICT, set_aspect
    keep = STRICT["aspect"]
    want = 1.6 if request.get("strict") is False else keep
    set_aspect(want) if want != keep else None
    try:
        return _verify_plan(plan, request)
    finally:
        set_aspect(keep) if want != keep else None


def _verify_parking(plan: Dict[str, Any], request: Dict[str, Any], floors, foot, errs: List[str]) -> int:
    """Parking is what was asked for: one usable bay per car in a porch on the road edge of the ground floor,
    clear of every other room; and no parking at all when none was asked for."""
    from backend.planner.architect.rules import CAR_BAY_L, CAR_BAY_W, PARK_MIN_DEPTH, park_width
    from backend.planner.architect.site import parking_mix
    cars, bikes = parking_mix(bool(request.get("parking_required")), request.get("parking_spaces", 1), request.get("parking_type", ""))
    fx0, fy0, fx1, fy1 = foot
    side = plan.get("road_side", "North")
    ground = floors[0]["layout"]["rooms"]
    n = 0
    park = [(fl["floor"], r) for fl in floors for r in fl["layout"]["rooms"] if r["room_type"] in ("parking", "bike_parking")]
    n += 1
    if not cars and not bikes:
        if park:
            errs.append("parking was not requested but the plan contains a parking space")
        return n
    if any(fl != floors[0]["floor"] for fl, _ in park):
        errs.append("parking must be on the ground floor")
    cp = [r for fl, r in park if r["room_type"] == "parking"]
    bp = [r for fl, r in park if r["room_type"] == "bike_parking"]
    if cars:
        n += 4
        if len(cp) != 1:
            errs.append(f"{cars} car(s) requested but the plan has {len(cp)} car parking space(s)")
            return n
        r = cp[0]
        role = f"cars{cars}" + ("+bikes" if bikes else "")
        along_x = side in ("North", "South")              # frontage along x; on an East / West road the porch is turned
        p_across, p_depth = (r["width"], r["length"]) if along_x else (r["length"], r["width"])
        if p_across < park_width("parking", role) - 0.06 or p_depth < PARK_MIN_DEPTH["parking"] - 0.06:
            errs.append(f"car parking {p_across}x{p_depth} ft (across the road x deep) is too small for {cars} car(s)")
        touches = {"North": abs(r["y"] - fy0) < TOL, "South": abs(r["y2"] - fy1) < TOL,
                   "West": abs(r["x"] - fx0) < TOL, "East": abs(r["x2"] - fx1) < TOL}[side]
        if not touches:
            errs.append("car parking does not open onto the road")
        pk = plan.get("parking") or {}
        bays = pk.get("bays") or []
        if len(bays) != cars:
            errs.append(f"{cars} car bay(s) requested but {len(bays)} placed")
        for b in bays:
            bb = {"x": b["x"], "y": b["y"], "x2": b["x"] + b["width"], "y2": b["y"] + b["length"]}
            across, along = (b["width"], b["length"]) if side in ("North", "South") else (b["length"], b["width"])
            if across < CAR_BAY_W - 0.06 or along < CAR_BAY_L - 0.06:
                errs.append("a car bay is smaller than the vehicle plus its clearance")
            if bb["x"] < r["x"] - TOL or bb["y"] < r["y"] - TOL or bb["x2"] > r["x2"] + TOL or bb["y2"] > r["y2"] + TOL:
                errs.append("a car bay lies outside its parking porch")
            for o in ground:
                if o["id"] != r["id"] and _overlap(bb, o):
                    errs.append(f"a car bay overlaps {o['name']}")
    if bikes and not cars:
        n += 1
        if len(bp) != 1:
            errs.append(f"{bikes} bike(s) requested but the plan has {len(bp)} bike parking space(s)")
    return n


def _verify_plan(plan: Dict[str, Any], request: Dict[str, Any]) -> Dict[str, Any]:
    errs: List[str] = []
    checks = 0
    floors = plan["floors"]
    rect = plan["terrace"]
    fx0, fy0, fx1, fy1 = rect["x"], rect["y"], rect["x"] + rect["width"], rect["y"] + rect["length"]
    foot = rect["width"] * rect["length"]
    stairs = []
    for fl in floors:
        lay = fl["layout"]
        rooms = lay["rooms"]
        roofs = lay.get("roof_areas", [])               # open flat roof of the floor below: not a room, but part of the footprint
        nm = fl["floor"]
        # inside + no overlap + exact coverage
        checks += 3
        shapes = rooms + roofs
        for r in shapes:
            if r["x"] < fx0 - TOL or r["y"] < fy0 - TOL or r["x2"] > fx1 + TOL or r["y2"] > fy1 + TOL:
                errs.append(f"{nm}: {r['name']} lies outside the building footprint")
        for i in range(len(shapes)):
            for j in range(i + 1, len(shapes)):
                if _overlap(shapes[i], shapes[j]):
                    errs.append(f"{nm}: {shapes[i]['name']} overlaps {shapes[j]['name']}")
        tot = sum(r["width"] * r["length"] for r in shapes)
        if abs(tot - foot) > 0.5:
            errs.append(f"{nm}: rooms cover {tot:.1f} sq ft of a {foot:.1f} sq ft footprint")
        by = {r["id"]: r for r in rooms}
        # room dimension rules and daylight
        for r in rooms:
            checks += 1
            if not room_ok(rule_for(r["room_type"]), r["width"], r["length"]):
                errs.append(f"{nm}: {r['name']} {r['width']}x{r['length']} breaks its size rule")
            if r["room_type"] in HABITABLE:
                checks += 1
                ext = 0.0
                if abs(r["x"] - fx0) < TOL: ext = max(ext, r["length"])
                if abs(r["x2"] - fx1) < TOL: ext = max(ext, r["length"])
                if abs(r["y"] - fy0) < TOL: ext = max(ext, r["width"])
                if abs(r["y2"] - fy1) < TOL: ext = max(ext, r["width"])
                if ext < 3.5:
                    errs.append(f"{nm}: {r['name']} has no exterior wall for light")
                if not any(w["room"] == r["id"] for w in lay["openings"]["windows"]):
                    errs.append(f"{nm}: {r['name']} has no window")
        # attached baths
        for r in rooms:
            if r["room_type"] == "bathroom" and r.get("attached_to"):
                checks += 1
                par = by.get(r["attached_to"])
                if par is None or _edge_contact(r, par) < 3.5:
                    errs.append(f"{nm}: {r['name']} is not beside its bedroom")
        # doors lie on real shared walls; reachability
        adj = {r["id"]: set() for r in rooms}
        for d in lay["openings"]["doors"]:
            checks += 1
            if d["connects_to"] is None:
                continue
            a, b = by.get(d["room"]), by.get(d["connects_to"])
            if a is None or b is None or _edge_contact(a, b) < d["width"] - 0.01:
                errs.append(f"{nm}: door between {d['room']} and {d['connects_to']} is not on a shared wall")
                continue
            adj[a["id"]].add(b["id"]); adj[b["id"]].add(a["id"])
        root = lay["openings"]["circulation"]["entry_room"]
        seen, queue = {root}, [root]
        while queue:
            cur = queue.pop()
            for nx in adj.get(cur, ()):
                if nx not in seen:
                    seen.add(nx); queue.append(nx)
        checks += 1
        if len(seen) != len(rooms):
            missing = [by[i]["name"] for i in by if i not in seen]
            errs.append(f"{nm}: unreachable rooms: {', '.join(missing)}")
        for r in rooms:
            if r["room_type"] == "staircase":
                stairs.append((r["x"], r["y"], r["x2"], r["y2"]))
    # staircase identical on all floors
    if len(floors) > 1:
        checks += 1
        if len(stairs) != len(floors) or any(
                max(abs(a - b) for a, b in zip(stairs[0], s)) > TOL for s in stairs[1:]):
            errs.append("staircase is not in the same place on every floor")
    # the stair is entered at one short end only, the same end on every floor
    if len(floors) > 1:
        checks += 1
        ends = set()
        sides = []                           # upper-floor side doors on the stair: (floor, stair id, axis, (lo, hi))
        for fi_, fl in enumerate(floors):
            lay = fl["layout"]
            st = next((r for r in lay["rooms"] if r["room_type"] == "staircase"), None)
            if not st:
                continue
            vert = (st["y2"] - st["y"]) >= (st["x2"] - st["x"])
            for d in lay["openings"]["doors"]:
                if st["id"] not in (d.get("room"), d.get("connects_to")):
                    continue
                if vert and abs(d["y1"] - d["y2"]) < 0.01 and min(abs(d["y1"] - st["y"]), abs(d["y1"] - st["y2"])) < 0.06:
                    ends.add(("y", round(d["y1"], 1)))
                elif (not vert) and abs(d["x1"] - d["x2"]) < 0.01 and min(abs(d["x1"] - st["x"]), abs(d["x1"] - st["x2"])) < 0.06:
                    ends.add(("x", round(d["x1"], 1)))
                elif fi_ > 0:
                    # upstairs the top landing may open sideways (into the passage / lobby), within the landing depth of the entry end
                    sides.append((fi_, st["id"], "y" if vert else "x", (min(d["y1"], d["y2"]), max(d["y1"], d["y2"])) if vert else (min(d["x1"], d["x2"]), max(d["x1"], d["x2"]))))
                else:
                    errs.append("staircase has a door on its side wall")
        # the entry end of the stair, from the ground floor (its door is always at the entry end)
        for fi_, sid, axis, (lo_, hi_) in sides:
            st_ = next(r for r in floors[fi_]["layout"]["rooms"] if r["id"] == sid)
            vert_ = (st_["y2"] - st_["y"]) >= (st_["x2"] - st_["x"])
            lo_e, hi_e = (st_["y"], st_["y2"]) if vert_ else (st_["x"], st_["x2"])
            ent = next((v for a, v in ends if a == axis and (abs(v - lo_e) < 0.1 or abs(v - hi_e) < 0.1)), None)
            if ent is None:
                ent = lo_e if min(abs(lo_ - lo_e), abs(hi_ - lo_e)) <= min(abs(lo_ - hi_e), abs(hi_ - hi_e)) else hi_e
            if not (lo_ >= ent - LANDING_DEPTH - 0.06 and hi_ <= ent + LANDING_DEPTH + 0.06):
                errs.append("staircase has a door on its side wall")
        if len(ends) > 1:
            errs.append("staircase is entered from different ends on different floors")
    # main entrance on the road-facing wall
    g = floors[0]["layout"]
    main = [d for d in g["openings"]["doors"] if d["door_type"] == "main"]
    checks += 1
    side = plan.get("road_side", "North")
    want = {"North": "top", "South": "bottom", "East": "right", "West": "left"}[side]
    if len(main) != 1 or main[0]["wall"] != want:
        errs.append(f"main door is not on the {side.lower()} (road) wall")
    # program counts
    want_rooms = request.get("rooms", [])
    def cnt(t): return sum(1 for r in want_rooms if (r.get("room_type") if isinstance(r, dict) else r) == t)
    all_rooms = [r for fl in floors for r in fl["layout"]["rooms"]]
    for t in ("living_room", "dining", "kitchen", "utility", "puja_room", "bathroom"):
        checks += 1
        have = sum(1 for r in all_rooms if r["room_type"] == t)
        if have < cnt(t):
            errs.append(f"requested {cnt(t)} {t}(s) but plan has {have}")
    checks += 1
    have_b = sum(1 for r in all_rooms if r["room_type"] in BEDROOM_TYPES)
    want_b = cnt("master_bedroom") + cnt("bedroom") + cnt("guest_bedroom")
    if have_b != max(want_b, 1 if want_b else 0):
        errs.append(f"requested {want_b} bedrooms but plan has {have_b}")
    if request.get("balcony_required") and len(floors) > 1:
        for fi, fl in enumerate(floors[1:], start=1):
            lay = fl["layout"]
            hosts = [r for r in lay["rooms"] if r["room_type"] in BEDROOM_TYPES or r["room_type"] == "family_lounge"]
            if not hosts:
                continue
            checks += 1
            bal = [r for r in lay["rooms"] if r["room_type"] == "balcony"]
            if not bal:
                errs.append(f"floor {fi}: a balcony was requested but none was planned")
                continue
            b = bal[0]
            htypes = {r["id"]: r["room_type"] for r in hosts}
            linked = [d for d in lay["openings"]["doors"]
                      if (d.get("room") == b["id"] and d.get("connects_to") in htypes)
                      or (d.get("connects_to") == b["id"] and d.get("room") in htypes)]
            if not linked:
                errs.append(f"floor {fi}: the balcony has no door to a bedroom or lounge")
    checks += _verify_parking(plan, request, floors, (fx0, fy0, fx1, fy1), errs)
    # circulation: every indoor room reachable by an indoor route, terraces / balconies never a route, no room used as a corridor
    from backend.planner.architect.circulation import analyse_building
    circ = analyse_building(plan)
    checks += 1 + sum(f["indoor_rooms"] for f in circ["floors"])
    errs += circ["errors"]
    # the brief itself, from the frozen specification: exact room counts (in total and per floor), floor count, terrace, parking, proportions
    from backend.planner.architect.spec import build_spec, violations
    checks += 1
    try:
        for v in violations(build_spec(request), plan):
            if v["hard"]:
                errs.append(v["message"])
    except ValueError as exc:
        errs.append(str(exc))
    return {"passed": not errs, "checks": checks, "errors": errs}
