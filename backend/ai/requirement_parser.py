"""Deterministic natural-language requirement extraction for the planner."""

import re
from typing import Dict, Optional

from backend.planner.style_knowledge import LEGACY_STYLE_MAP, SUPPORTED_STYLES, canonical_style, get_style_profile, normalize_style_name
from backend.planner.climate_knowledge import get_climate_profile, normalize_climate_name


NUMBER_WORDS = {
    "one": 1, "a": 1, "an": 1, "two": 2, "three": 3,
    "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10,
}
BUILDING_TYPES = {"Ground", "G+1", "G+2", "Duplex", "Villa"}
STYLE_NAMES = {normalize_style_name(name): name for name in SUPPORTED_STYLES}   # the three supported styles; older names are mapped, see LEGACY_STYLE_MAP
CLIMATE_NAMES = {
    normalize_climate_name(name): name
    for name in ("Hot & Humid", "Hot & Dry", "Warm and Moderate", "Composite", "Cold", "Temperate")
}


def _number(value: str) -> Optional[int]:
    value = value.lower().strip()
    return int(value) if value.isdigit() else NUMBER_WORDS.get(value)


def _first_number(pattern: str, text: str) -> Optional[int]:
    match = re.search(pattern, text, re.IGNORECASE)
    return _number(match.group(1)) if match else None


def _canonical_building_type(text: str) -> Optional[str]:
    lower = text.lower()
    if re.search(r"\b(g\s*\+\s*2|ground\s+plus\s+two)\b", lower):
        return "G+2"
    if re.search(r"\b(g\s*\+\s*1|ground\s+plus\s+one)\b", lower):
        return "G+1"
    for name in ("duplex", "villa"):
        if re.search(rf"\b{name}\b", lower):
            return name.title()
    if re.search(r"\bground(?:\s+floor)?\s+(?:house|home|building)\b", lower):
        return "Ground"
    return None


def _canonical_road_side(text: str) -> Optional[str]:
    match = re.search(r"\b(north|south|east|west)(?:[- ]facing|[- ]road|[- ]side)?\b", text, re.IGNORECASE)
    return match.group(1).title() if match else None


def _canonical_style(text: str) -> Optional[str]:
    lower = text.lower()
    for key, display_name in STYLE_NAMES.items():
        if key.replace("_", " ") in lower:
            return display_name
    if re.search(r"\bwadas?\b", lower):                      # "a wada style home", "wada house"
        return canonical_style("wada")
    for key, display_name in LEGACY_STYLE_MAP.items():      # a name of an earlier version typed in a brief: read as the style it became
        if key.replace("_", " ") in lower:
            return display_name
    return None


def _canonical_climate(text: str) -> Optional[str]:
    lower = text.lower()
    if re.search(r"\bauto(?:matic)?\s+climate\b|\bclimate\s+auto\b", lower):
        return "Auto"
    for key, display_name in CLIMATE_NAMES.items():
        if key.replace("_", " ") in lower:
            return display_name
    match = re.search(r"\bcustom\s+climate\s*[:\-]?\s*([\w ]+)", text, re.IGNORECASE)
    return match.group(1).strip().title() if match else None


def _parse_rooms(house: Dict) -> list:
    rooms = []
    if house.get("living") is not False:
        rooms.append({"room_type": "living_room"})
    if house.get("dining") is not False:
        rooms.append({"room_type": "dining"})
    if house.get("kitchen") is not False:
        rooms.append({"room_type": "kitchen"})
    if house.get("utility"):
        rooms.append({"room_type": "utility"})
    bedrooms = house.get("bedrooms")
    if bedrooms:
        rooms.append({"room_type": "master_bedroom"})
        rooms.extend({"room_type": "bedroom"} for _ in range(max(0, bedrooms - 1)))
    for _ in range(house.get("bathrooms") or 0):
        rooms.append({"room_type": "bathroom"})
    if house.get("puja"):
        rooms.append({"room_type": "puja_room"})
    if house.get("guest_room"):
        rooms.append({"room_type": "guest_bedroom"})
    return rooms


def parse_requirements(text: str) -> Dict:
    """Extract planner requirements without generating geometry or coordinates."""
    source = str(text or "").strip()
    lower = source.lower()
    requirements = {
        "plot": {}, "house": {}, "family": {}, "preferences": {},
        "planning": {}, "rooms": [],
    }
    missing = []
    ambiguities = []
    warnings = []

    dimensions = re.search(r"(\d+(?:\.\d+)?)\s*(?:ft\s*)?(?:by|x|×)\s*(\d+(?:\.\d+)?)", lower)
    if dimensions:
        requirements["plot"].update({"width": float(dimensions.group(1)), "length": float(dimensions.group(2))})
    else:
        missing.append("plot dimensions are required")
    unit_match = re.search(r"\b(feet|foot|ft|meters?|m)\b", lower)
    if unit_match:
        requirements["plot"]["unit"] = "Meters" if unit_match.group(1).startswith("m") else "Feet"
    road_side = _canonical_road_side(lower)
    if road_side:
        requirements["plot"]["road_side"] = road_side
        requirements["plot"]["north_orientation"] = "north_up"
    else:
        ambiguities.append("road side/orientation")

    setback_values = {}
    for side in ("front", "rear", "left", "right"):
        match = re.search(rf"{side}\s+setback\s*(?:of|is|:)??\s*(\d+(?:\.\d+)?)", lower)
        if match:
            setback_values[side] = float(match.group(1))
    if setback_values:
        requirements["plot"]["setbacks"] = setback_values

    bhk = _first_number(r"\b(\d+|one|two|three|four|five|six|seven|eight)\s*(?:bhk|bed\s*room|bedroom)s?\b", lower)
    if bhk is not None:
        requirements["house"]["bedrooms"] = bhk
    if bhk is not None and not 1 <= bhk <= 8:
        warnings.append("bedroom count must be between 1 and 8")
    bathrooms = _first_number(r"\b(\d+|one|two|three|four|five|six|seven|eight)\s*(?:bathrooms?|baths?)\b", lower)
    if bathrooms is not None:
        requirements["house"]["bathrooms"] = bathrooms
    building_type = _canonical_building_type(lower)
    if building_type:
        requirements["house"]["building_type"] = building_type
        requirements["house"]["number_of_floors"] = {"Ground": 1, "G+1": 2, "G+2": 3, "Duplex": 2, "Villa": 3}[building_type]
    for feature, pattern in {
        "parking": r"\bparking\b", "living": r"\bliving(?:\s+room)?\b",
        "dining": r"\bdining(?:\s+room)?\b", "kitchen": r"\bkitchen\b",
        "utility": r"\b(?:utility|laundry)\b", "puja": r"\bpuja\b",
        "guest_room": r"\bguest\s+(?:room|bedroom)\b",
        "balconies": r"\bbalcon(?:y|ies)\b", "terrace": r"\bterrace\b",
    }.items():
        if re.search(pattern, lower):
            requirements["house"][feature] = True
    parking_count = _first_number(r"\b(\d+|one|two)\s*(?:car|cars)\b", lower)
    if parking_count:
        requirements["house"]["parking_spaces"] = parking_count
    if re.search(r"\bno\s+parking\b", lower):
        requirements["house"]["parking"] = False
    elif "parking" in requirements["house"]:
        requirements["house"]["parking"] = True
    kitchen_match = re.search(r"\b(open|closed|modular|traditional)\s+kitchen\b", lower)
    if kitchen_match:
        requirements["house"]["kitchen_type"] = kitchen_match.group(1).title()

    family_size = _first_number(r"\bfamily\s+of\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b", lower)
    if family_size is None:
        family_size = _first_number(r"\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:people|persons|members)\b", lower)
    if family_size is not None:
        requirements["family"]["family_size"] = family_size
    elif re.search(r"\bfamily\b", lower):
        ambiguities.append("family_size")
    for key, pattern in {
        "adults": r"\b(\d+|one|two|three|four|five|six|seven|eight)\s+adults?\b",
        "children": r"\b(\d+|one|two|three|four|five|six|seven|eight)\s+children\b",
        "elderly": r"\b(\d+|one|two|three|four|five|six|seven|eight)\s+elderly\b",
    }.items():
        value = _first_number(pattern, lower)
        if value is not None:
            requirements["family"][key] = value
    if re.search(r"\b(?:elderly\s+parents?|parents?\s+are\s+elderly)\b", lower):
        requirements["family"]["elderly"] = 2
    if re.search(r"\b(?:elderly|aged)\b.*\bground\s+floor\b|\bground\s+floor\b.*\b(?:elderly|aged)\b", lower):
        requirements["family"]["ground_floor_master_required"] = True
    if re.search(r"\bprivacy\b", lower):
        requirements["family"]["privacy_required"] = True
    if re.search(r"\b(joint family|working professionals|frequent guests|large family|small family)\b", lower):
        requirements["family"]["lifestyle"] = re.search(r"\b(joint family|working professionals|frequent guests|large family|small family)\b", lower).group(1).title()

    vastu_mode = "strict" if re.search(r"\bstrict\s+vastu\b", lower) else "basic" if re.search(r"\bbasic\s+vastu\b|\bvastu\b", lower) else "no_preference" if re.search(r"\bno\s+vastu\b", lower) else None
    if vastu_mode:
        requirements["preferences"]["vastu_mode"] = vastu_mode
    style = _canonical_style(source)
    if style:
        requirements["preferences"]["architectural_style"] = canonical_style(style)
    climate = _canonical_climate(source)
    if climate:
        requirements["preferences"]["climate"] = climate
        if climate not in CLIMATE_NAMES.values() and climate != "Auto":
            get_climate_profile(climate)

    planning_patterns = {
        "courtyard": r"\bcourtyard\b", "garden": r"\bgarden\b",
        "open_space": r"\bopen\s+space|outdoor\b", "daylight": r"\bdaylight|natural\s+light\b",
        "ventilation": r"\bventilation|cross\s+ventilation\b", "circulation": r"\bcirculation\b",
        "attached_bathroom": r"\battached\s+bathroom\b", "dressing": r"\bdressing|walk[- ]in\b",
    }
    for key, pattern in planning_patterns.items():
        if re.search(pattern, lower):
            requirements["planning"][key] = True
    if re.search(r"\bhot\s+(?:and\s+)?humid\b.*\b(?:good|high|strong)\s+ventilation\b|\b(?:good|high|strong)\s+ventilation\b", lower):
        requirements["preferences"]["ventilation_priority"] = "high"
    if "ventilation_priority" not in requirements["preferences"] and "ventilation" in requirements["planning"]:
        requirements["preferences"]["ventilation_priority"] = "high"

    if requirements["house"].get("bedrooms"):
        requirements["rooms"] = _parse_rooms(requirements["house"])
    if re.search(r"\blarge\s+house\b", lower) and not dimensions:
        ambiguities.append("plot dimensions are required")
    if "bedrooms" not in requirements["house"]:
        missing.append("bedroom count or BHK is required")
    if any(value is not None and not 1 <= value <= 8 for value in (bhk, bathrooms)):
        warnings.append("requested room counts exceed the deterministic planner range")

    invalid = any("must be between" in warning for warning in warnings)
    success = not missing and not ambiguities and not invalid
    return {
        "success": success,
        "requirements": requirements,
        "missing": list(dict.fromkeys(missing)),
        "ambiguities": list(dict.fromkeys(ambiguities)),
        "warnings": list(dict.fromkeys(warnings)),
    }
