import unittest

from backend.planner.dimension_engine import generate_room_dimensions
from backend.planner.style_knowledge import (
    REQUIRED_PROFILE_FIELDS,
    get_style_profile,
    load_style_profiles,
    normalize_style_name,
    score_layout_style,
)
from backend.planner.vastu_rules import evaluate_vastu


class StyleKnowledgeTests(unittest.TestCase):
    def test_the_three_style_profiles_load_with_required_fields(self):
        profiles = load_style_profiles()
        self.assertEqual(sorted(p["name"] for p in profiles.values()), ["Maharashtrian Wada", "Modern Minimalistic", "Traditional Indian"])
        for profile in profiles.values():
            self.assertTrue(REQUIRED_PROFILE_FIELDS <= profile.keys())

    def test_style_name_normalization(self):
        self.assertEqual(normalize_style_name(" Minimalistic-Luxury "), "minimalistic_luxury")
        self.assertEqual(get_style_profile("Modern Indian")["name"], "Modern Minimalistic")        # an old name opens as one of the two styles

    def test_unknown_style_returns_neutral_profile(self):
        profile = get_style_profile("Custom Studio Style")
        self.assertEqual(profile["name"], "Modern Minimalistic")        # unknown text becomes the default style, never a third style
        self.assertIn("preferred_openness", profile)
        self.assertIsInstance(profile["preferred_room_relationships"], list)

    def test_styles_produce_different_scores_and_dimensions(self):
        layout = {
            "usable_plot": {"width": 34, "length": 42},
            "remaining_area": 900,
            "rooms": [
                {"room_type": "living_room"},
                {"room_type": "dining"},
                {"room_type": "kitchen"},
                {"room_type": "utility"},
            ],
            "open_spaces": {"regions": [{"type": "courtyard"}]},
        }
        modern_score = score_layout_style(layout, "Modern Minimalistic")["score"]
        luxury_score = score_layout_style(layout, "Traditional Indian")["score"]
        self.assertNotEqual(modern_score, luxury_score)

        modern_rooms = generate_room_dimensions(
            layout["rooms"], strategy="balanced", floor_area=1400,
            style="Modern Minimalistic",
        )
        traditional_rooms = generate_room_dimensions(
            layout["rooms"], strategy="balanced", floor_area=1400,
            style="Traditional Indian",
        )
        self.assertNotEqual(
            [(room["width"], room["length"]) for room in modern_rooms],
            [(room["width"], room["length"]) for room in traditional_rooms],
        )

    def test_vastu_engine_contract_remains_unchanged(self):
        result = evaluate_vastu([], 34, 42, "no_preference")
        self.assertEqual(result["mode"], "no_preference")
        self.assertEqual(result["overall_score"], 100)
        self.assertIn("rooms", result)


if __name__ == "__main__":
    unittest.main()
