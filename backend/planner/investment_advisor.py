def investment_snapshot(result, plot_area):
    plans=result.get("plans",[])
    best=max(plans,key=lambda p:(p.get("distribution_score",0),p.get("occupied_ratio",0)),default={})
    score=55
    score += min(20, best.get("distribution_score",0)*.2)
    score += min(15, best.get("occupied_ratio",0)*20)
    if result.get("parking",{}).get("required"): score += 5
    return {"score":round(min(100,score),1),"recommended_plan":best.get("name",""),"reason":"Balances usable floor area, distribution and practical amenities. This is a planning indicator, not financial advice."}
