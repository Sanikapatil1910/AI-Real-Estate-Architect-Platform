from math import hypot


def analyze_energy(layout, plot, road_side="North", climate="Warm/Composite", solar=True):
    rooms = layout.get("rooms", [])
    total = plot["width"] * plot["length"]
    score = 72.0
    if climate.lower().startswith("hot") or climate.lower().startswith("warm"):
        score += 5
    public = [r for r in rooms if r["room_type"] in {"living_room", "dining"}]
    if public:
        score += 5
    score = min(100, score)
    solar_kw = round(max(1.5, min(8.0, total * .0015)), 1) if solar else 0
    return {
        "score": round(score, 1),
        "climate": climate,
        "daylight_strategy": "Prioritize larger openings on road-facing and east/north sides where feasible.",
        "ventilation_strategy": "Keep opposite-side openings and avoid sealing the courtyard/open-space pockets.",
        "solar_recommendation": f"Approx. {solar_kw} kW rooftop solar allowance." if solar else "Solar not selected.",
        "passive_design_notes": ["Cross ventilation", "Daylight-first public rooms", "Shaded openings", "Roof solar zone"],
    }
