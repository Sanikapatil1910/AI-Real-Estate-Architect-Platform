"""Structured climate and passive-energy planning knowledge."""

import json
from pathlib import Path
from typing import Dict, Optional


CLIMATE_DIRECTORY = Path(__file__).resolve().parents[2] / "knowledge" / "climate"
REQUIRED_PROFILE_FIELDS = {
    "climate_name", "ventilation_priority", "cross_ventilation_priority",
    "daylight_priority", "opening_preference", "shading_preference",
    "courtyard_preference", "veranda_preference", "balcony_preference",
    "outdoor_space_preference", "compactness_preference",
    "heat_gain_reduction_preference", "passive_cooling_strategies",
    "passive_heating_strategies", "indoor_outdoor_connection",
    "roof_terrace_considerations", "recommended_planning_strategies",
}


def normalize_climate_name(climate_name: str) -> str:
    """Return a stable climate lookup key."""
    value = str(climate_name or "").strip().lower().replace("-", " ")
    value = value.replace("&", " and ").replace("/", " and ")
    normalized = "_".join(value.split())
    aliases = {
        "hot_humid": "hot_and_humid",
        "hot_dry": "hot_and_dry",
        "warm_composite": "warm_and_composite",
    }
    return aliases.get(normalized, normalized)


def _neutral_profile(climate_name: str = "Custom") -> Dict:
    return {
        "climate_name": climate_name or "Custom",
        "ventilation_priority": "balanced",
        "cross_ventilation_priority": "balanced",
        "daylight_priority": "balanced",
        "opening_preference": "balanced_openings",
        "shading_preference": "moderate",
        "courtyard_preference": False,
        "veranda_preference": False,
        "balcony_preference": "optional",
        "outdoor_space_preference": "moderate",
        "compactness_preference": "balanced",
        "heat_gain_reduction_preference": "moderate",
        "passive_cooling_strategies": [],
        "passive_heating_strategies": [],
        "indoor_outdoor_connection": "moderate",
        "roof_terrace_considerations": "standard roof planning",
        "recommended_planning_strategies": ["preserve basic daylight, ventilation, and feasible circulation"],
    }


def load_climate_profile(directory: Optional[Path] = None) -> Dict[str, Dict]:
    """Load all climate profiles from the project-relative JSON directory."""
    profile_directory = Path(directory) if directory else CLIMATE_DIRECTORY
    profiles = {}
    for path in sorted(profile_directory.glob("*.json")):
        with path.open("r", encoding="utf-8") as climate_file:
            profile = json.load(climate_file)
        profiles[normalize_climate_name(profile.get("climate_name", path.stem))] = profile
    return profiles


_CLIMATE_PROFILES = load_climate_profile()


def get_climate_profile(climate_name: str = "Composite") -> Dict:
    """Return a loaded profile or a neutral profile for unknown climates."""
    return _CLIMATE_PROFILES.get(
        normalize_climate_name(climate_name),
        _neutral_profile(climate_name or "Custom"),
    )


def get_climate_preferences(climate_name: str = "Composite") -> Dict:
    profile = get_climate_profile(climate_name)
    return {
        "ventilation": profile["ventilation_priority"],
        "cross_ventilation": profile["cross_ventilation_priority"],
        "daylight": profile["daylight_priority"],
        "openings": profile["opening_preference"],
        "shading": profile["shading_preference"],
        "courtyard": profile["courtyard_preference"],
        "veranda": profile["veranda_preference"],
        "indoor_outdoor": profile["indoor_outdoor_connection"],
        "compactness": profile["compactness_preference"],
    }


def _priority_score(priority: str) -> float:
    value = str(priority).lower()
    if "very_high" in value or value == "very high":
        return 100.0
    if "high" in value:
        return 85.0
    if "moderate" in value or "balanced" in value:
        return 70.0
    if "low" in value:
        return 50.0
    return 70.0


def score_climate_layout(layout: Dict, climate_name: str = "Composite") -> Dict:
    """Return deterministic soft climate-fit scores for a generated layout."""
    profile = get_climate_profile(climate_name)
    rooms = layout.get("rooms", [])
    usable = layout.get("usable_plot", {})
    usable_area = float(usable.get("width", 0)) * float(usable.get("length", 0))
    open_area = float(layout.get("remaining_area", 0))
    openness = open_area / usable_area if usable_area else 0.0
    desired_openness = 0.75 if profile["outdoor_space_preference"] in {"high", "moderate_high"} else 0.45
    openness_score = max(0.0, 100.0 - abs(openness - desired_openness) * 100.0)

    habitable = {"living_room", "dining", "kitchen", "master_bedroom", "bedroom", "guest_bedroom", "puja_room"}
    habitable_rooms = [room for room in rooms if room.get("room_type") in habitable]
    usable_x, usable_y = usable.get("x", 0), usable.get("y", 0)
    usable_x2 = usable_x + usable.get("width", 0)
    usable_y2 = usable_y + usable.get("length", 0)
    boundary_rooms = [
        room for room in habitable_rooms
        if abs(room.get("x", 0) - usable_x) < 0.05
        or abs(room.get("x2", 0) - usable_x2) < 0.05
        or abs(room.get("y", 0) - usable_y) < 0.05
        or abs(room.get("y2", 0) - usable_y2) < 0.05
    ]
    daylight_score = 100.0 * len(boundary_rooms) / max(1, len(habitable_rooms))
    cross_score = 100.0 if len(boundary_rooms) >= 2 else (65.0 if boundary_rooms else 40.0)
    regions = layout.get("open_spaces", {}).get("regions", [])
    region_types = {region.get("type") for region in regions}
    open_space_score = 100.0
    if profile["courtyard_preference"] and "courtyard" not in region_types:
        open_space_score -= 20.0
    if profile["veranda_preference"] and "front_open_space" not in region_types:
        open_space_score -= 10.0

    score = round(
        daylight_score * 0.30
        + cross_score * 0.35
        + openness_score * 0.20
        + open_space_score * 0.15,
        2,
    )
    return {
        "climate": profile["climate_name"],
        "score": score,
        "daylight_score": round(daylight_score, 2),
        "cross_ventilation_score": round(cross_score, 2),
        "openness_score": round(openness_score, 2),
        "open_space_score": round(open_space_score, 2),
        "soft_preference": True,
        "passive_cooling_strategies": profile["passive_cooling_strategies"],
        "passive_heating_strategies": profile["passive_heating_strategies"],
    }
