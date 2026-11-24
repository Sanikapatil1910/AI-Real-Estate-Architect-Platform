"""Deterministic human-readable requirement summaries and clarification prompts."""

from typing import Dict, List

from backend.planner.floor_manager import BUILDING_FLOORS


VALID_ROADS = {"North", "South", "East", "West"}


def _add_missing(missing: List[str], value: str) -> None:
    if value not in missing:
        missing.append(value)


def _format_plot(plot: Dict) -> str:
    unit = plot.get("unit", "Feet")
    suffix = "ft" if str(unit).lower().startswith(("f", "m")) and unit == "Feet" else unit
    return f"{plot['width']:g} × {plot['length']:g} {suffix}".strip()


def _family_summary(family: Dict) -> str:
    parts = []
    if family.get("family_size") is not None:
        parts.append(f"{family['family_size']} people")
    if family.get("adults") is not None:
        parts.append(f"{family['adults']} adults")
    if family.get("children") is not None:
        parts.append(f"{family['children']} children")
    return ", ".join(parts)


def summarize_requirements(parse_result: Dict) -> Dict:
    """Summarize only values present in a parser result."""
    parsed_requirements = parse_result.get("requirements", {}) if isinstance(parse_result, dict) else {}
    plot = parsed_requirements.get("plot", {})
    house = parsed_requirements.get("house", {})
    family = parsed_requirements.get("family", {})
    preferences = parsed_requirements.get("preferences", {})
    summary = {}

    if plot.get("width") is not None and plot.get("length") is not None:
        summary["plot"] = _format_plot(plot)
    if plot.get("road_side"):
        summary["road"] = plot["road_side"]
    if house.get("bedrooms") is not None:
        summary["bedrooms"] = house["bedrooms"]
    if house.get("building_type"):
        summary["building_type"] = house["building_type"]
    family_text = _family_summary(family)
    if family_text:
        summary["family"] = family_text
    if family.get("elderly") is not None:
        summary["elderly"] = family["elderly"]
    if preferences.get("vastu_mode"):
        summary["vastu"] = {
            "strict": "Strict", "basic": "Basic", "no_preference": "None",
        }.get(preferences["vastu_mode"], preferences["vastu_mode"])
    if preferences.get("architectural_style"):
        summary["style"] = preferences["architectural_style"]
    if preferences.get("climate"):
        summary["climate"] = preferences["climate"]
    if preferences.get("ventilation_priority"):
        summary["ventilation"] = preferences["ventilation_priority"].title()

    missing = list(parse_result.get("missing", [])) if isinstance(parse_result, dict) else []
    ambiguities = list(parse_result.get("ambiguities", [])) if isinstance(parse_result, dict) else []
    warnings = list(parse_result.get("warnings", [])) if isinstance(parse_result, dict) else []

    if plot.get("width") is None or plot.get("length") is None:
        _add_missing(missing, "plot dimensions")
    if plot.get("road_side") not in VALID_ROADS:
        _add_missing(missing, "road side")
    if not house.get("bedrooms") or not parsed_requirements.get("rooms"):
        _add_missing(missing, "bedroom requirement")
    if house.get("building_type") not in BUILDING_FLOORS:
        _add_missing(missing, "building type")
    if family.get("family_size") is None and "family_size" not in ambiguities:
        _add_missing(missing, "family size")
    if preferences.get("vastu_mode") is None:
        _add_missing(missing, "Vastu preference")
    if preferences.get("architectural_style") is None:
        _add_missing(missing, "architectural style")
    if preferences.get("climate") is None:
        _add_missing(missing, "climate")
    if house.get("parking") is None:
        _add_missing(missing, "parking preference")

    setbacks = plot.get("setbacks", {})
    if any(float(value) < 0 for value in setbacks.values()):
        _add_missing(warnings, "setbacks must be nonnegative")

    minimum_valid = (
        isinstance(plot.get("width"), (int, float))
        and plot["width"] > 0
        and isinstance(plot.get("length"), (int, float))
        and plot["length"] > 0
        and plot.get("road_side") in VALID_ROADS
        and isinstance(house.get("bedrooms"), int)
        and 1 <= house["bedrooms"] <= 8
        and bool(parsed_requirements.get("rooms"))
        and house.get("building_type") in BUILDING_FLOORS
        and not any(float(value) < 0 for value in setbacks.values())
    )
    ready = bool(parse_result.get("success")) and minimum_valid and not any(
        "between 1 and 8" in warning for warning in warnings
    )
    return {
        "summary": summary,
        "missing": missing,
        "ambiguities": ambiguities,
        "warnings": warnings,
        "ready_for_planning": ready,
    }


def build_clarification_questions(parse_result: Dict) -> List[str]:
    """Create concise questions only for missing or ambiguous parser fields."""
    result = summarize_requirements(parse_result)
    fields = list(result["missing"])
    fields.extend(result["ambiguities"])
    questions = []
    question_map = {
        "plot dimensions": "What are the plot dimensions?",
        "road side": "Which direction does the road face: North, South, East, or West?",
        "bedroom requirement": "How many bedrooms or what BHK do you need?",
        "building type": "How many floors or what building type do you want?",
        "family size": "How many people will live in the house?",
        "family_size": "How many people will live in the house?",
        "Vastu preference": "Which Vastu preference should I use: None, Basic, or Strict?",
        "architectural style": "Which architectural style do you prefer?",
        "climate": "Which climate should I plan for?",
        "parking preference": "Do you need parking, and how many spaces?",
        "road side/orientation": "Which direction does the road face?",
    }
    for field in fields:
        question = question_map.get(field)
        if question and question not in questions:
            questions.append(question)
    return questions
