"""Structured architectural-style planning knowledge."""

import json
from pathlib import Path
from typing import Dict, Iterable, Optional


STYLE_DIRECTORY = Path(__file__).resolve().parents[2] / "knowledge" / "styles"
REQUIRED_PROFILE_FIELDS = {
    "name", "planning_philosophy", "preferred_layout_type",
    "preferred_room_relationships", "preferred_room_sizes",
    "preferred_openness", "corridor_preference",
    "indoor_outdoor_relationship", "courtyard_preference",
    "veranda_preference", "balcony_preference",
    "ceiling_volume_preference", "natural_light_preference",
    "ventilation_preference", "traditional_space_requirements",
    "puja_preference", "kitchen_planning", "entrance_characteristics",
    "material_appearance_hints",
}


MODERN_STYLE = "Modern Minimalistic"
TRADITIONAL_STYLE = "Traditional Indian"
WADA_STYLE = "Maharashtrian Wada"
SUPPORTED_STYLES = (MODERN_STYLE, TRADITIONAL_STYLE, WADA_STYLE)    # the only architectural styles the application offers

# Style names written by earlier versions of the application (saved projects, stored payloads, old requirement text) and what they become.
# Nothing is dropped: a saved project that said "South Indian Traditional" opens as "Traditional Indian"; "Minimalistic Luxury" as "Modern Minimalistic".
LEGACY_STYLE_MAP = {
    "minimalistic_luxury": MODERN_STYLE,
    "contemporary_indian": MODERN_STYLE,
    "modern_indian": MODERN_STYLE,
    "traditional_maharashtrian": TRADITIONAL_STYLE,
    "south_indian_traditional": TRADITIONAL_STYLE,
}
_TRADITIONAL_HINTS = ("tradition", "heritage", "maharashtr", "south_indian", "kerala", "vintage", "classic", "nalukettu")


def normalize_style_name(style_name: str) -> str:
    """Return a stable lookup key for a display style name."""
    return "_".join(str(style_name or "").strip().lower().replace("-", " ").split())


def canonical_style(style_name) -> str:
    """The supported style a stored / requested style name stands for.  Always one of ``SUPPORTED_STYLES``.

    The supported names (any capitalisation) are themselves; the five names of earlier versions are mapped by ``LEGACY_STYLE_MAP``; the word
    "wada" means Maharashtrian Wada; other traditional wording means Traditional Indian; anything else (blank, unknown, custom text) becomes the
    default, Modern Minimalistic.
    """
    key = normalize_style_name(style_name)
    for name in SUPPORTED_STYLES:
        if key == normalize_style_name(name):
            return name
    if key in LEGACY_STYLE_MAP:
        return LEGACY_STYLE_MAP[key]
    if "wada" in key.split("_") or "wadas" in key.split("_"):
        return WADA_STYLE
    return TRADITIONAL_STYLE if any(h in key for h in _TRADITIONAL_HINTS) else MODERN_STYLE


def _neutral_profile(style_name: str = "Custom") -> Dict:
    return {
        "name": style_name or "Custom",
        "planning_philosophy": "Neutral planning with practical room sizes and circulation.",
        "preferred_layout_type": "functional_plan",
        "preferred_room_relationships": [],
        "preferred_room_sizes": {},
        "preferred_openness": 0.65,
        "corridor_preference": "efficient",
        "indoor_outdoor_relationship": "moderate",
        "courtyard_preference": False,
        "veranda_preference": False,
        "balcony_preference": "optional",
        "ceiling_volume_preference": "standard",
        "natural_light_preference": "balanced",
        "ventilation_preference": "balanced",
        "traditional_space_requirements": [],
        "puja_preference": "accommodate_when_requested",
        "kitchen_planning": "practical kitchen and service connection",
        "entrance_characteristics": "clear, practical entrance",
        "material_appearance_hints": "neutral material treatment",
    }


def load_style_profiles(directory: Optional[Path] = None) -> Dict[str, Dict]:
    """Load all JSON profiles from the stable project-relative directory."""
    profile_directory = Path(directory) if directory else STYLE_DIRECTORY
    profiles = {}
    for path in sorted(profile_directory.glob("*.json")):
        with path.open("r", encoding="utf-8") as style_file:
            profile = json.load(style_file)
        profiles[normalize_style_name(profile.get("name", path.stem))] = profile
    return profiles


_STYLE_PROFILES = load_style_profiles()


def get_style_profile(style_name: str = "Modern Minimalistic") -> Dict:
    """The profile of the style (legacy names are mapped to one of the supported styles)."""
    profile = _STYLE_PROFILES.get(normalize_style_name(canonical_style(style_name)))
    if profile is None:
        return _neutral_profile(canonical_style(style_name))
    return profile


def get_room_size_factor(style_name: str, room_type: str) -> float:
    profile = get_style_profile(style_name)
    return float(profile.get("preferred_room_sizes", {}).get(room_type, 1.0))


def score_room_size(style_name: str, room_type: str, area: float, preferred_area: float) -> float:
    """Score a room area against the style's preferred relative size."""
    target = preferred_area * get_room_size_factor(style_name, room_type)
    if target <= 0:
        return 50.0
    return round(max(0.0, 100.0 - abs(area - target) / target * 100.0), 2)


def _relationship_key(pair: Iterable[str]) -> tuple:
    return tuple(str(value) for value in pair)


def score_layout_style(layout: Dict, style_name: str = "Modern Minimalistic") -> Dict:
    """Score style-fit without overriding architectural feasibility checks."""
    profile = get_style_profile(style_name)
    usable_plot = layout.get("usable_plot", {})
    usable_area = float(usable_plot.get("width", 0)) * float(usable_plot.get("length", 0))
    open_area = float(layout.get("remaining_area", 0))
    openness = open_area / usable_area if usable_area else 0.0
    openness_score = max(0.0, 100.0 - abs(openness - float(profile["preferred_openness"])) * 100.0)

    regions = layout.get("open_spaces", {}).get("regions", [])
    region_types = {region.get("type") for region in regions}
    open_space_score = 100.0
    if profile.get("courtyard_preference") and "courtyard" not in region_types:
        open_space_score -= 25.0
    if profile.get("veranda_preference") and "front_open_space" not in region_types:
        open_space_score -= 10.0

    relationship_score = 100.0
    rooms = layout.get("rooms", [])
    room_types = {room.get("room_type") for room in rooms}
    preferred_relationships = [
        _relationship_key(pair)
        for pair in profile.get("preferred_room_relationships", [])
    ]
    if preferred_relationships:
        present = sum(
            1 for first, second in preferred_relationships
            if first in room_types and second in room_types
        )
        relationship_score = present / len(preferred_relationships) * 100.0

    score = round(openness_score * 0.45 + open_space_score * 0.25 + relationship_score * 0.30, 2)
    return {
        "style": profile["name"],
        "score": score,
        "openness_score": round(openness_score, 2),
        "open_space_score": round(open_space_score, 2),
        "relationship_score": round(relationship_score, 2),
        "preferred_openness": profile["preferred_openness"],
    }


def get_style_relationship_weight(style_name: str, room_a: str, room_b: str, base_weight: int) -> int:
    profile = get_style_profile(style_name)
    pair = _relationship_key((room_a, room_b))
    reverse = _relationship_key((room_b, room_a))
    preferred = {_relationship_key(item) for item in profile.get("preferred_room_relationships", [])}
    if pair in preferred or reverse in preferred:
        return base_weight + 3
    return base_weight


# ---------------------------------------------------------------------------------------------------------------- design notes
# What each style does to the house, in plain words (shown in "Why this concept was generated").  The notes only describe how the house is
# dressed and which features the 3D design layer adds; none of them changes a wall, a room or an opening of the validated plan.
STYLE_DESIGN_NOTES: Dict[str, list] = {
    MODERN_STYLE: [
        "Modern Minimalistic: clean geometry, a neutral palette, flat roofs with chajjas, simple openings and contemporary furniture.",
    ],
    TRADITIONAL_STYLE: [
        "Traditional Indian: terracotta tile roofs, a pillared entrance verandah, carved timber doors and timber-beamed ceilings, with heritage furniture.",
    ],
    WADA_STYLE: [
        "Maharashtrian Wada: a deep pillared verandah (otta) at the entrance with carved teak columns and brackets, a large carved entrance door, "
        "sloping tiled roofs with generous eaves and a muted ochre, cream and terracotta palette.",
        "Inside: stone flooring, timber ceilings, jali windows, low gadi seating with bolsters, a jhula (swing) and warm lantern light.",
        "A central courtyard (chowk) is only built where the plan already has one. This plan's walls and rooms are never moved to fit the style; "
        "a courtyard that would change the layout is proposed separately and needs your approval first.",
    ],
}


def style_design_notes(style_name) -> list:
    """Plain-language notes about what the style does (never structural)."""
    return list(STYLE_DESIGN_NOTES.get(canonical_style(style_name), []))
