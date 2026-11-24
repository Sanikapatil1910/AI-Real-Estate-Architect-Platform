"""Explainable architectural reasoning."""
def explain_plan(plan):
    reasons=[]
    rooms=[r for f in plan.get("floors",[]) for r in f.get("layout",{}).get("rooms",[])]
    types={r.get("room_type") for r in rooms}
    if {"living_room","dining"} <= types: reasons.append("Living and dining form the public transition zone so guests need not cross private bedrooms.")
    if {"dining","kitchen"} <= types: reasons.append("Dining and kitchen are kept functionally close to reduce daily serving movement.")
    if {"kitchen","utility"} <= types: reasons.append("Utility is kept near the kitchen for practical laundry and service movement.")
    if any(r.get("room_type") in {"master_bedroom","bedroom","guest_bedroom"} for r in rooms): reasons.append("Bedrooms are treated as a private zone away from the primary entrance where the plot permits.")
    if any(r.get("room_type")=="staircase" for r in rooms): reasons.append("The staircase is integrated with common circulation for practical multi-floor access.")
    return reasons
