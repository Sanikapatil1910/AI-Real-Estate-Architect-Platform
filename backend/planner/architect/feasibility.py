"""Feasibility check: can this brief fit on this plot at all?

Runs before any layout is attempted. It reports, per floor, how much area the
brief needs at minimum and at comfortable sizes against what the plot offers,
and when the brief cannot fit it searches for concrete changes that would.
"""

from __future__ import annotations

import math
from copy import deepcopy
from typing import Any, Dict, List, Optional

from backend.planner.architect.program import FLOOR_NAMES, build_program
from backend.planner.architect.rules import REQUESTABLE, rule_for
from backend.planner.architect.site import PARKING_BAY_W, Site, site_from_request

CIRCULATION_MIN = 0.07        # share of a floor that is passage at the very least
CIRCULATION_PREF = 0.11


def _yard_depth(site: Site) -> float:
    """Depth (along the road axis) that must stay free of building."""
    depth = 0.0
    # parking is a covered porch INSIDE the house footprint (a ground-floor room under the first floor),
    # so it needs no yard of its own; only a requested garden keeps a front strip clear
    if site.garden_required and (site.usable_depth - depth) > 0:
        depth += 8.0 if depth == 0 else 0.0
    return depth


def available_box(site: Site) -> Dict[str, float]:
    yard = _yard_depth(site)
    return {"frontage": site.usable_frontage, "depth": max(0.0, site.usable_depth - yard),
            "yard_depth": yard}


def spec_min_area(s) -> float:
    """Smallest area a room can really occupy.  The stair is a fixed footprint (flights + landings), the car porch is as wide as its vehicles and
    at least one bay long: neither can shrink to the generic rule minimum."""
    from backend.planner.architect.rules import PARK_MIN_DEPTH, park_width
    if s.type == "staircase":
        return float(s.target)
    if s.type in ("parking", "bike_parking"):
        return park_width(s.type, s.role) * PARK_MIN_DEPTH[s.type]
    return s.rule.min_a


def floor_need(fp) -> Dict[str, float]:
    """Area one floor needs.  `hard` is the lower bound (every room at its minimum, stair and porch at their real footprint, no extra passage:
    living / dining / lounge double as circulation).  `practical` adds the share of passage a floor normally needs."""
    specs = fp.all_specs()
    hard = sum(spec_min_area(s) for s in specs)
    return {"hard": hard, "practical": hard / (1.0 - CIRCULATION_MIN),
            "comfortable": sum(s.target for s in specs) / (1.0 - CIRCULATION_PREF)}


def analyse(site: Site, program) -> Dict[str, Any]:
    """Area/dimension analysis of a program on a site. No layout is built.

    Every floor is judged against its own buildable area (the floors share one footprint, so each has the same capacity); the area of a
    second floor is never counted towards the ground floor."""
    box = available_box(site)
    cap = box["frontage"] * box["depth"]
    floors = []
    worst = "ok"
    reasons: List[str] = []
    for fp in program.floors:
        specs = fp.all_specs()
        need = floor_need(fp)
        status = "ok"
        if need["hard"] > cap + 1e-6:
            status = "infeasible"
            reasons.append(
                f"{fp.name}: needs at least {need['hard']:.0f} sq ft (every room at its minimum size, the staircase and any car porch at their real "
                f"footprint) but the buildable area is {cap:.0f} sq ft.")
        elif need["practical"] > cap + 1e-6:
            status = "very_tight"
        elif need["comfortable"] > cap * 1.0:
            status = "tight" if need["practical"] <= cap * 0.93 else "very_tight"
        floors.append({
            "floor": fp.name,
            "rooms": len(specs),
            "min_area_needed": round(need["hard"]),
            "practical_area_needed": round(need["practical"]),
            "comfortable_area_needed": round(need["comfortable"]),
            "buildable_area": round(cap),
            "status": status,
        })
        order = ["ok", "tight", "very_tight", "infeasible"]
        if order.index(status) > order.index(worst):
            worst = status
    # narrow frontage: stair (7) + one passage lane (3.5) + a room (9) must fit across
    if box["frontage"] < 12.0:
        worst = "infeasible"
        reasons.append(f"Usable plot width {box['frontage']:.1f} ft is too narrow to plan a house (minimum about 12 ft).")
    # the building must be deep enough for its widest-needed room: every room's short side has to fit inside the depth (or the frontage)
    need_depth = 0.0
    for fp in program.floors:
        for s in fp.all_specs():
            if s.type in ("parking", "bike_parking", "staircase"):
                continue
            need_depth = max(need_depth, s.rule.min_s)
    if box["depth"] < need_depth - 1e-6:
        worst = "infeasible"
        reasons.append(f"Only {box['depth']:.1f} ft of buildable depth remain after setbacks; the rooms asked for need a shortest side of "
                       f"at least {need_depth:.1f} ft.")
    # largest single room must fit across the narrower side
    for fp in program.floors:
        for s in fp.all_specs():
            r = s.rule
            if min(box["frontage"], box["depth"]) < r.min_s and max(box["frontage"], box["depth"]) < r.min_s:
                worst = "infeasible"
                reasons.append(f"{s.name} cannot fit inside the buildable area.")
    ground_porch = [s for s in program.floors[0].specs if s.type in ("parking", "bike_parking")]
    from backend.planner.architect.rules import PARK_MIN_DEPTH
    porch_fits = all(box["depth"] >= PARK_MIN_DEPTH[s.type] - 1e-6 for s in ground_porch)
    return {"status": worst, "buildable_box": box, "buildable_area": round(cap), "floors": floors,
            "reasons": reasons, "porch_fits": porch_fits}


# ------------------------------------------------------------------------
def _site_and_program(payload: Dict[str, Any]):
    from backend.planner.architect.spec import normalise_site
    payload = normalise_site(payload)                  # the user's frontage choice decides which plot side faces the road
    site = site_from_request(
        payload["plot_width"], payload["plot_length"], payload.get("road_side", "North"),
        payload.get("setbacks"), payload.get("parking_required", False),
        payload.get("parking_spaces", 1), payload.get("garden_required", False),
        payload.get("parking_type", ""),
    )
    program = build_program(
        payload.get("rooms", []), payload.get("building_type", "Ground"),
        payload.get("family_context"), payload.get("balcony_required", False),
        payload.get("floor_height", 10), payload.get("stair_width", 3.5),
        exact=True,
        separate_toilet=str(payload.get("common_toilet", "attached")).lower() == "separate",
        parking=(site.cars, site.bikes),
        floor_rooms=payload.get("floor_rooms"),
        ground_bedroom=payload.get("_ground_bedroom"),
        compact_stair=bool(payload.get("_compact_stair")),
    )
    return site, program


def _variants(payload: Dict[str, Any]):
    """Concrete changes to try, cheapest-to-accept first."""
    rooms = payload.get("rooms", [])
    types = [r.get("room_type") for r in rooms]

    def drop(rtype, label, n=1):
        idx = [i for i, t in enumerate(types) if t == rtype]
        if not idx:
            return None
        p = deepcopy(payload)
        for i in sorted(idx[-n:], reverse=True):
            p["rooms"].pop(i)
        return label, p

    out = []
    if payload.get("parking_required"):
        p = deepcopy(payload); p["parking_required"] = False
        out.append(("Remove the parking requirement (or park on the street / use stilt parking)", p))
    if payload.get("garden_required"):
        p = deepcopy(payload); p["garden_required"] = False
        out.append(("Skip the garden", p))
    bt = payload.get("building_type", "Ground")
    nxt = {"Ground": "G+1", "G+1": "G+2", "Duplex": "G+2"}.get(bt)
    if nxt:
        p = deepcopy(payload); p["building_type"] = nxt
        out.append((f"Build {nxt} instead of {bt}, which gives more floor area on the same plot", p))
    for rtype, label in (("puja_room", "Drop the puja room"), ("utility", "Drop the utility room"),
                         ("study", "Drop the study"), ("family_lounge", "Drop the family lounge"),
                         ("guest_bedroom", "Drop the guest bedroom")):
        v = drop(rtype, label)
        if v:
            out.append(v)
    nb = types.count("bathroom")
    if nb > 2:
        v = drop("bathroom", f"Reduce bathrooms from {nb} to {nb - 1}")
        if v:
            out.append(v)
    nbed = types.count("bedroom")
    if nbed > 0:
        v = drop("bedroom", f"Reduce bedrooms from {nbed + 1} to {nbed} (and one bathroom)")
        if v:
            label, p = v
            if p["rooms"] and any(r.get("room_type") == "bathroom" for r in p["rooms"]) and \
                    [r.get("room_type") for r in p["rooms"]].count("bathroom") > 1:
                idx = max(i for i, r in enumerate(p["rooms"]) if r.get("room_type") == "bathroom")
                p["rooms"].pop(idx)
            out.append((label, p))
    if sum(payload.get("setbacks", {}).values() if payload.get("setbacks") else [0]) > 0:
        p = deepcopy(payload)
        p["setbacks"] = {k: 0 for k in ("front", "rear", "left", "right")}
        out.append(("Setbacks of 0 on all sides (only if local bylaws allow)", p))
    return out


def check_request(payload: Dict[str, Any], suggest: bool = True) -> Dict[str, Any]:
    """Feasibility report for a generate-request payload."""
    errors: List[str] = []
    site = program = None
    try:
        site, program = _site_and_program(payload)
    except (KeyError, ValueError, TypeError) as exc:
        return {"feasible": False, "status": "invalid", "errors": [str(exc)], "warnings": [],
                "floors": [], "suggestions": []}
    errors.extend(program.errors)
    if site.usable_frontage <= 0 or site.usable_depth <= 0:
        errors.append("Setbacks leave no usable plot area.")
    if errors:
        return {"feasible": False, "status": "invalid", "errors": errors, "warnings": program.warnings,
                "floors": [], "suggestions": []}
    res = analyse(site, program)
    feasible = res["status"] != "infeasible"
    report = {
        "feasible": feasible,
        "status": res["status"],
        "errors": [] if feasible else res["reasons"],
        "warnings": list(program.warnings),
        "floors": res["floors"],
        "buildable_area": res["buildable_area"],
        "buildable_frontage": round(res["buildable_box"]["frontage"], 1),
        "buildable_depth": round(res["buildable_box"]["depth"], 1),
        "suggestions": [],
    }
    if res["status"] in ("tight", "very_tight"):
        report["warnings"].append(
            "The plot is tight for this brief: rooms will be close to their minimum sizes and "
            "there may be fewer genuinely different layouts."
        )
    if suggest and not feasible:
        found = []
        for label, p in _variants(payload):
            try:
                s2, pr2 = _site_and_program(p)
            except (KeyError, ValueError):
                continue
            if pr2.errors:
                continue
            r2 = analyse(s2, pr2)
            if r2["status"] in ("ok", "tight", "very_tight"):
                found.append({"change": label, "result": r2["status"], "patch": {
                    k: p[k] for k in ("rooms", "building_type", "parking_required", "garden_required", "setbacks")
                    if k in p and p[k] != payload.get(k)}})
            if len(found) >= 4:
                break
        report["suggestions"] = found
    return report
