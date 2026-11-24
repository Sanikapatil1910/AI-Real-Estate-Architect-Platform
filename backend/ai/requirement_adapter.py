"""Adapter from parsed requirements to the deterministic planner contract."""

from backend.planner.style_knowledge import canonical_style
from copy import deepcopy

from backend.ai.requirement_parser import parse_requirements
from backend.planner.multi_floor_multi_layout import generate_project_plans
from backend.planner.plot_rules import create_plot
from backend.planner.floor_manager import BUILDING_FLOORS


class RequirementAdapterError(ValueError):
    """Raised when parsed requirements cannot form a planner request."""


def _feet(value, unit):
    return float(value) * (3.28084 if str(unit).lower().startswith("m") else 1.0)


def _validate_rooms(rooms):
    if not rooms:
        raise RequirementAdapterError("at least one requested room is required")
    for room in rooms:
        if set(room) - {"room_type"}:
            raise RequirementAdapterError("AI requirements may not contain geometry fields")
        if not room.get("room_type"):
            raise RequirementAdapterError("each requested room must have a room_type")


def build_planner_request(requirements):
    """Build only the arguments accepted by ``generate_project_plans``."""
    if not isinstance(requirements, dict):
        raise RequirementAdapterError("requirements must be an object")

    plot_requirements = requirements.get("plot", {})
    house = requirements.get("house", {})
    family = requirements.get("family", {})
    preferences = requirements.get("preferences", {})
    rooms = deepcopy(requirements.get("rooms", []))

    width = plot_requirements.get("width")
    length = plot_requirements.get("length")
    if width is None or length is None:
        raise RequirementAdapterError("plot width and length are required")
    unit = plot_requirements.get("unit", "Feet")
    width_ft = _feet(width, unit)
    length_ft = _feet(length, unit)
    if width_ft <= 0 or length_ft <= 0:
        raise RequirementAdapterError("plot dimensions must be greater than zero")

    road_side = plot_requirements.get("road_side", "North")
    if road_side not in {"North", "South", "East", "West"}:
        raise RequirementAdapterError("road_side must be North, South, East, or West")

    building_type = house.get("building_type", "Ground")
    if building_type not in BUILDING_FLOORS:
        raise RequirementAdapterError(f"unsupported building type: {building_type}")

    bedrooms = house.get("bedrooms")
    if bedrooms is None or not isinstance(bedrooms, int) or not 1 <= bedrooms <= 8:
        raise RequirementAdapterError("bedroom count must be an integer between 1 and 8")
    bathrooms = house.get("bathrooms")
    if bathrooms is not None and (not isinstance(bathrooms, int) or not 1 <= bathrooms <= 8):
        raise RequirementAdapterError("bathroom count must be an integer between 1 and 8")

    setbacks = plot_requirements.get("setbacks", {})
    setback_values = {
        side: _feet(setbacks.get(side, 0), unit)
        for side in ("front", "rear", "left", "right")
    }
    plot_result = create_plot(
        plot_width=width_ft,
        plot_length=length_ft,
        road_side=road_side,
        **{f"{side}_setback": value for side, value in setback_values.items()},
    )
    if not plot_result.get("valid"):
        raise RequirementAdapterError("invalid plot or setbacks: " + "; ".join(plot_result.get("errors", [])))

    _validate_rooms(rooms)
    usable_plot = {
        **plot_result["usable_plot"],
        "x": setback_values["left"],
        "y": setback_values["front"],
        "area": plot_result["usable_plot"]["width"] * plot_result["usable_plot"]["length"],
    }

    parking = bool(house.get("parking", False))
    parking_spaces = int(house.get("parking_spaces", 1)) if parking else 1
    if parking_spaces < 1:
        raise RequirementAdapterError("parking spaces must be at least 1")

    family_context = {
        key: value
        for key, value in family.items()
        if key in {
            "family_size", "adults", "children", "elderly", "guests",
            "ground_floor_master_required", "privacy_required", "lifestyle",
        }
    }

    return {
        "rooms": rooms,
        "plot": plot_result["plot"],
        "usable_plot": usable_plot,
        "building_type": building_type,
        "road_side": road_side,
        "parking_required": parking,
        "parking_spaces": parking_spaces,
        "vastu_mode": preferences.get("vastu_mode", "no_preference"),
        "architectural_style": canonical_style(preferences.get("architectural_style")),
        "family_context": family_context,
        "climate": preferences.get("climate", "Auto"),
    }


def plan_from_text(text):
    """Parse text, adapt it, and invoke the deterministic planner."""
    parsed = parse_requirements(text)
    if not parsed["success"]:
        return parsed
    try:
        planner_request = build_planner_request(parsed["requirements"])
    except RequirementAdapterError as exc:
        return {
            "success": False,
            "requirements": parsed["requirements"],
            "missing": [],
            "ambiguities": [],
            "warnings": [str(exc)],
        }
    return generate_project_plans(**planner_request)
