"""Indicative construction cost estimator."""
def estimate_cost(floors, rate_per_sqft=2200):
    data=[]; total=0.0
    for floor in floors:
        area=float(floor.get("layout",{}).get("used_room_area",0)); cost=area*rate_per_sqft; total+=cost
        data.append({"floor":floor.get("floor","Floor"),"built_up_area":round(area,2),"estimated_cost":round(cost,2)})
    return {"rate_per_sqft":rate_per_sqft,"total_built_up_area":round(sum(x["built_up_area"] for x in data),2),"estimated_total_cost":round(total,2),"floors":data,"note":"Indicative estimate only; local rates, structure, finishes and approvals can change the final cost."}
