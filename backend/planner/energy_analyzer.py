"""Deterministic passive-design analysis for generated layouts."""

from backend.planner.climate_knowledge import (
    get_climate_profile,
    score_climate_layout,
)

def analyze_energy(layout, road_side="North", climate="Auto"):
    rooms = layout.get("rooms", [])
    if not rooms:
        return {"score": 0, "light_score": 0, "ventilation_score": 0, "recommendations": []}
    profile = get_climate_profile(climate)
    usable = layout.get("usable_plot", {})
    x0, y0 = usable.get("x", 0), usable.get("y", 0)
    x1, y1 = x0 + usable.get("width", 0), y0 + usable.get("length", 0)
    habitable = {"living_room", "dining", "kitchen", "master_bedroom", "bedroom", "guest_bedroom", "puja_room"}
    hab = [r for r in rooms if r["room_type"] in habitable]
    exterior = sum(1 for r in hab if abs(r["x"]-x0)<.05 or abs(r["x2"]-x1)<.05 or abs(r["y"]-y0)<.05 or abs(r["y2"]-y1)<.05)
    light = min(100, 55 + exterior / max(1, len(hab)) * 45)
    climate_score = score_climate_layout(layout, climate)
    ventilation = light * 0.45 + climate_score["cross_ventilation_score"] * 0.55
    light = light * 0.45 + climate_score["daylight_score"] * 0.55
    rec=[]
    if light < 80: rec.append("Increase external openings for major habitable rooms.")
    if ventilation < 80: rec.append("Provide openings on additional external faces where geometry permits cross-ventilation.")
    rec.append(f"Use {profile['shading_preference']} shading and openings suited to the selected climate profile.")
    rec.extend(profile["recommended_planning_strategies"][:2])
    return {
        "score": round((light+ventilation)/2,1),
        "light_score":round(light,1),
        "ventilation_score":round(ventilation,1),
        "climate":profile["climate_name"],
        "climate_analysis":climate_score,
        "opening_strategy":profile["opening_preference"],
        "shading_strategy":profile["shading_preference"],
        "recommendations":rec,
    }
