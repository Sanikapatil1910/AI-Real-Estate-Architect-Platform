"""Dataset-backed Vastu knowledge access."""

import csv
from pathlib import Path
from typing import Dict, List, Optional


DATASET_PATH = Path(__file__).with_name("indian_vastu_floor_plan_rules.csv")

ROOM_FEATURES = {
    "living_room": ("Hall/living", "Living room"),
    "master_bedroom": ("Master bedroom",),
    "bedroom": ("Secondary bedroom",),
    "guest_bedroom": ("Secondary bedroom", "Guest bedroom"),
    "kitchen": ("Kitchen",),
    "dining": ("Dining room", "Dining"),
    "utility": ("Utility",),
    "bathroom": ("Bathroom",),
    "puja_room": ("Puja room",),
    "staircase": ("Staircase",),
    "courtyard": ("Courtyard",),
    "garden": ("Garden", "Garden/open space"),
    "parking": ("Parking",),
    "balcony": ("Balcony",),
    "terrace": ("Terrace room", "Terrace"),
}


def _normalize(value: str) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _normalize_rule(row: Dict[str, str]) -> Dict[str, object]:
    normalized = {key: str(value or "").strip() for key, value in row.items()}
    normalized.update({
        "category_normalized": _normalize(normalized["category"]),
        "feature_normalized": _normalize(normalized["feature"]),
        "preference_normalized": _normalize(normalized["preference"]),
        "zone_normalized": _normalize(normalized["zone_or_condition"]),
        "hard_constraint_bool": _normalize(normalized["hard_constraint"]) in {"yes", "true", "1"},
    })
    return normalized


def load_vastu_rules(path: Optional[Path] = None) -> List[Dict[str, object]]:
    """Load and normalize all rules from the bundled CSV dataset."""
    dataset_path = Path(path) if path else DATASET_PATH
    with dataset_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        return [_normalize_rule(row) for row in csv.DictReader(csv_file)]


_RULES = load_vastu_rules()


def get_vastu_rules() -> List[Dict[str, object]]:
    return list(_RULES)


def get_rules_for_feature(feature: str) -> List[Dict[str, object]]:
    normalized = _normalize(feature)
    return [rule for rule in _RULES if rule["feature_normalized"] == normalized]


def get_rules_for_category(category: str) -> List[Dict[str, object]]:
    normalized = _normalize(category)
    return [rule for rule in _RULES if rule["category_normalized"] == normalized]


def get_rules_for_room(room_type: str) -> List[Dict[str, object]]:
    features = {_normalize(feature) for feature in ROOM_FEATURES.get(room_type, ())}
    return [rule for rule in _RULES if rule["feature_normalized"] in features]
