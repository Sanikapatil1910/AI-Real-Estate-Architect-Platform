import unittest

from backend.planner.climate_knowledge import (
    REQUIRED_PROFILE_FIELDS,
    get_climate_preferences,
    get_climate_profile,
    load_climate_profile,
    normalize_climate_name,
    score_climate_layout,
)
from backend.planner.dimension_engine import generate_room_dimensions
from backend.planner.openings import generate_openings
from backend.planner.vastu_rules import evaluate_vastu


class ClimateKnowledgeTests(unittest.TestCase):
    def test_all_profiles_load_with_required_fields(self):
        profiles = load_climate_profile()
        self.assertEqual(len(profiles), 6)
        for profile in profiles.values():
            self.assertTrue(REQUIRED_PROFILE_FIELDS <= profile.keys())

    def test_normalization_and_unknown_fallback(self):
        self.assertEqual(normalize_climate_name("Hot-Humid"), "hot_and_humid")
        self.assertEqual(get_climate_profile("Hot / Dry")["climate_name"], "Hot and Dry")
        fallback = get_climate_profile("Custom Microclimate")
        self.assertEqual(fallback["climate_name"], "Custom Microclimate")
        self.assertIn("cross_ventilation", get_climate_preferences("Custom Microclimate"))

    def test_climate_profiles_produce_different_scores(self):
        layout = {
            "usable_plot": {"x": 3, "y": 5, "width": 34, "length": 42},
            "remaining_area": 800,
            "rooms": [
                {"room_type": "living_room", "x": 3, "y": 5, "x2": 15, "y2": 15},
                {"room_type": "bedroom", "x": 15, "y": 15, "x2": 25, "y2": 25},
            ],
            "open_spaces": {"regions": [{"type": "courtyard"}]},
        }
        hot_humid = score_climate_layout(layout, "Hot and Humid")
        cold = score_climate_layout(layout, "Cold")
        self.assertNotEqual(hot_humid["score"], cold["score"])
        self.assertTrue(hot_humid["soft_preference"])

    def test_climate_changes_openings_and_open_space_preferences(self):
        rooms = [{"room_type": "living_room", "x": 3, "y": 37, "width": 12, "length": 10, "x2": 15, "y2": 47}]
        usable_plot = {"x": 3, "y": 5, "width": 34, "length": 42}
        humid = generate_openings(rooms, usable_plot, "North", "Hot and Humid")
        cold = generate_openings(rooms, usable_plot, "North", "Cold")
        self.assertGreater(humid["windows"][0]["width"], cold["windows"][0]["width"])
        self.assertNotEqual(
            get_climate_preferences("Hot and Humid")["cross_ventilation"],
            get_climate_preferences("Cold")["cross_ventilation"],
        )

    def test_vastu_and_style_interfaces_remain_usable(self):
        self.assertEqual(evaluate_vastu([], 34, 42, "no_preference")["overall_score"], 100)
        modern = generate_room_dimensions(
            [{"room_type": "living_room"}], floor_area=1400,
            style="Modern Minimalistic",
        )
        luxury = generate_room_dimensions(
            [{"room_type": "living_room"}], floor_area=1400,
            style="Traditional Indian",
        )
        self.assertNotEqual(modern[0]["area"], luxury[0]["area"])


if __name__ == "__main__":
    unittest.main()
