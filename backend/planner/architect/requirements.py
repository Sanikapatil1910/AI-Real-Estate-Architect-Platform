"""Requirement-by-requirement compliance report.

The planner may have to change or drop things to produce any plan at all.  This module compares what was ASKED (the original payload) with what
the returned plan ACTUALLY contains (counted from the plan's own rooms, parking and floors -- never from what the search says it did), so the
report cannot claim more than the drawing delivers.

Priority tiers (see the project brief):
  1  mandatory architecture: setbacks, no overlap, circulation, stairs, doors, minimum sizes -- never traded away, so they are not scored here
     (a plan that breaks them is not returned); the report lists the ones that were *reduced to the code minimum* as compromises.
  2  user-requested functional requirements: rooms, bathrooms, parking, floors, features.
  3  optimisation preferences: comfortable sizes, 1:1.25 room shapes, stair proportions.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

BED_TYPES = ("master_bedroom", "bedroom", "guest_bedroom")
ROOM_LABEL = {
    "living_room": "Living room", "dining": "Dining room", "kitchen": "Kitchen", "utility": "Utility / laundry",
    "puja_room": "Puja room", "study": "Study", "family_lounge": "Family lounge",
}
# how much each Tier-2 item weighs in the score (a missing bedroom costs more than a missing study)
WEIGHT = {"bedrooms": 10, "bathrooms": 6, "attached_baths": 3, "parking": 8, "floors": 7, "living_room": 8, "kitchen": 8, "dining": 4, "utility": 3,
          "puja_room": 2, "study": 2, "family_lounge": 2, "balcony": 2, "terrace": 2, "garden": 2}


def _count(rooms) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for r in rooms or []:
        t = r.get("room_type") if isinstance(r, dict) else str(r)
        out[t] = out.get(t, 0) + 1
    return out


def requested(payload: Dict[str, Any]) -> Dict[str, Any]:
    """What the user asked for, normalised."""
    from backend.planner.architect.site import parking_mix
    c = _count(payload.get("rooms", []))
    cars, bikes = parking_mix(bool(payload.get("parking_required")), payload.get("parking_spaces", 1), payload.get("parking_type", ""))
    return {
        "building_type": payload.get("building_type", "Ground"),
        "floors": {"Ground": 1, "G+1": 2, "Duplex": 2, "G+2": 3, "Villa": 3}.get(payload.get("building_type", "Ground"), 1),
        "bedrooms": sum(c.get(t, 0) for t in BED_TYPES),
        "bathrooms": c.get("bathroom", 0) + c.get("toilet", 0),
        "cars": cars, "bikes": bikes,
        "rooms": {t: c.get(t, 0) for t in ROOM_LABEL},
        "balcony": bool(payload.get("balcony_required")),
        "terrace": bool(payload.get("include_terrace", False)),
        "garden": bool(payload.get("garden_required")),
        "setbacks": {k: float((payload.get("setbacks") or {}).get(k, 0) or 0) for k in ("front", "rear", "left", "right")},
        "vastu_mode": payload.get("vastu_mode", "no_preference"),
    }


def delivered(plan: Dict[str, Any]) -> Dict[str, Any]:
    """What the plan really contains."""
    rooms = [r for fl in plan["floors"] for r in fl["layout"]["rooms"]]
    c = _count(rooms)
    pk = plan.get("parking") or {}
    beds = [r for r in rooms if r["room_type"] in BED_TYPES]
    bed_ids = {r["id"] for r in beds}
    attached = sum(1 for r in rooms if r["room_type"] == "bathroom" and r.get("attached_to") in bed_ids)
    return {
        "building_type": plan.get("building_type"),
        "floors": len(plan["floors"]),
        "bedrooms": len(beds),
        "bathrooms": c.get("bathroom", 0) + c.get("toilet", 0),
        "attached_baths": attached,
        "cars": int(pk.get("cars", 0) or 0) if pk.get("placed", True) else 0,
        "bikes": int(pk.get("bikes", 0) or 0) if pk.get("placed", True) else 0,
        "parking_placement": pk.get("placement") or ("covered porch" if c.get("parking") or c.get("bike_parking") else None),
        "rooms": {t: c.get(t, 0) for t in ROOM_LABEL},
        "balcony": c.get("balcony", 0) > 0,
        "terrace": bool((plan.get("terrace") or {}).get("exists")),
        "garden": any(fl["layout"].get("garden") for fl in plan["floors"]),
    }


def _item(key, label, tier, asked, got, ok, detail="", weight=None) -> Dict[str, Any]:
    return {"key": key, "label": label, "tier": tier, "requested": asked, "delivered": got, "met": bool(ok), "detail": detail,
            "weight": WEIGHT.get(key, 1) if weight is None else weight}


def compliance(original: Dict[str, Any], plan: Dict[str, Any], strict: bool,
               adjustments: Optional[List[str]] = None, compromises: Optional[List[str]] = None) -> Dict[str, Any]:
    """Compare the original request with one plan."""
    want = requested(original)
    got = delivered(plan)
    items: List[Dict[str, Any]] = []
    items.append(_item("floors", "Floors", 2, want["building_type"], got["building_type"],
                       got["floors"] == want["floors"],
                       "" if got["floors"] == want["floors"] else f"{want['building_type']} was requested; the plan has {got['floors']} floor(s)."))
    items.append(_item("bedrooms", "Bedrooms", 2, want["bedrooms"], got["bedrooms"], got["bedrooms"] == want["bedrooms"],
                       "" if got["bedrooms"] == want["bedrooms"] else f"{want['bedrooms']} bedroom(s) requested, {got['bedrooms']} planned."))
    items.append(_item("bathrooms", "Bathrooms", 2, want["bathrooms"], got["bathrooms"], got["bathrooms"] == want["bathrooms"],
                       "" if got["bathrooms"] == want["bathrooms"] else f"{want['bathrooms']} bathroom(s) requested, {got['bathrooms']} planned."))
    # a bathroom attached to each bedroom is wanted when the user asked for at least as many bathrooms as bedrooms
    if want["bathrooms"] >= want["bedrooms"] > 0:
        need_att = min(want["bedrooms"], got["bedrooms"])
        items.append(_item("attached_baths", "Attached bathrooms", 2, want["bedrooms"], got["attached_baths"],
                           got["attached_baths"] >= need_att,
                           "" if got["attached_baths"] >= need_att else "Not every bedroom has its own bathroom."))
    for t, label in ROOM_LABEL.items():
        if want["rooms"].get(t):
            items.append(_item(t, label, 2, want["rooms"][t], got["rooms"].get(t, 0), got["rooms"].get(t, 0) == want["rooms"][t],
                               "" if got["rooms"].get(t, 0) == want["rooms"][t] else f"{want['rooms'][t]} {label.lower()} requested, {got['rooms'].get(t, 0)} planned."))
    if want["cars"] or want["bikes"]:
        ok = got["cars"] >= want["cars"] and got["bikes"] >= want["bikes"]
        txt = ", ".join(x for x in (f"{want['cars']} car(s)" if want["cars"] else "", f"{want['bikes']} bike(s)" if want["bikes"] else "") if x)
        gtxt = ", ".join(x for x in (f"{got['cars']} car(s)" if got["cars"] else "", f"{got['bikes']} bike(s)" if got["bikes"] else "") if x) or "none"
        items.append(_item("parking", "Parking", 2, txt, gtxt + (f" ({got['parking_placement']})" if got["parking_placement"] and (got["cars"] or got["bikes"]) else ""),
                           ok, "" if ok else "The parking asked for is not fully provided."))
    if want["balcony"]:
        items.append(_item("balcony", "Balcony", 2, True, got["balcony"], got["balcony"], "" if got["balcony"] else "No balcony in the plan."))
    items.append(_item("terrace", "Terrace", 2, "requested" if want["terrace"] else "not requested", "yes" if got["terrace"] else "no",
                       got["terrace"] == want["terrace"],
                       "" if got["terrace"] == want["terrace"] else ("No terrace in the plan." if want["terrace"] else "A terrace was added that was not requested.")))
    extra = sorted(t for t, n in got["rooms"].items() if n and not want["rooms"].get(t))
    if extra:
        items.append(_item("extra_rooms", "Rooms not asked for", 2, 0, sum(got["rooms"][t] for t in extra), False,
                           "The plan contains rooms that were not requested: " + ", ".join(extra) + "."))
    if want["garden"]:
        items.append(_item("garden", "Garden", 2, True, got["garden"], got["garden"], "" if got["garden"] else "No garden in the plan."))
    unmet = [i for i in items if not i["met"]]
    total = sum(i["weight"] for i in items) or 1
    score = round(100.0 * sum(i["weight"] for i in items if i["met"]) / total, 1)
    adjustments = list(adjustments or [])
    changed = bool(unmet) or bool(adjustments)
    return {
        "mode": "strict" if strict else "flexible",
        "exact": not changed,
        "satisfied": len(items) - len(unmet),
        "total": len(items),
        "score": score,
        "requested": want,
        "delivered": got,
        "items": items,
        "unmet": [{"key": i["key"], "label": i["label"], "requested": i["requested"], "delivered": i["delivered"], "reason": i["detail"]} for i in unmet],
        "adjustments": adjustments,
        "compromises": list(compromises or []),
        "setbacks_respected": True,
    }
