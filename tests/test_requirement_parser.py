import unittest

from backend.ai.requirement_parser import parse_requirements


class RequirementParserTests(unittest.TestCase):
    EXAMPLE = (
        "I have a 40 by 50 north-facing plot. I want a 3 BHK G+1 house "
        "for a family of four. My elderly parents should have a bedroom on "
        "the ground floor. I want strict Vastu, traditional Maharashtrian "
        "style and good ventilation because the climate is hot and humid."
    )

    def test_parses_plot_house_and_canonical_preferences(self):
        result = parse_requirements(self.EXAMPLE)
        self.assertTrue(result["success"])
        requirements = result["requirements"]
        self.assertEqual(requirements["plot"]["width"], 40.0)
        self.assertEqual(requirements["plot"]["length"], 50.0)
        self.assertEqual(requirements["plot"]["road_side"], "North")
        self.assertEqual(requirements["house"]["bedrooms"], 3)
        self.assertEqual(requirements["house"]["building_type"], "G+1")
        self.assertEqual(requirements["preferences"]["vastu_mode"], "strict")
        self.assertEqual(requirements["preferences"]["architectural_style"], "Traditional Indian")
        self.assertEqual(requirements["preferences"]["climate"], "Hot & Humid")

    def test_parses_words_and_family_floor_requirement(self):
        result = parse_requirements(
            "A three bedroom ground plus one home for a family of four, "
            "two adults and two children; elderly parents need a ground floor bedroom."
        )
        family = result["requirements"]["family"]
        self.assertEqual(result["requirements"]["house"]["bedrooms"], 3)
        self.assertEqual(result["requirements"]["house"]["building_type"], "G+1")
        self.assertEqual(family["family_size"], 4)
        self.assertEqual(family["adults"], 2)
        self.assertEqual(family["children"], 2)
        self.assertEqual(family["elderly"], 2)
        self.assertTrue(family["ground_floor_master_required"])

    def test_parses_house_features_and_planning_preferences(self):
        result = parse_requirements(
            "A 2 BHK villa with 2 bathrooms, parking for two cars, an open kitchen, "
            "puja room, guest room, courtyard, garden, balcony, terrace, daylight, ventilation, and privacy."
        )
        requirements = result["requirements"]
        self.assertTrue(requirements["house"]["parking"])
        self.assertEqual(requirements["house"]["parking_spaces"], 2)
        self.assertEqual(requirements["house"]["kitchen_type"], "Open")
        self.assertTrue(requirements["house"]["puja"])
        self.assertTrue(requirements["planning"]["courtyard"])
        self.assertTrue(requirements["planning"]["garden"])
        self.assertTrue(requirements["planning"]["dressing"] is False if "dressing" in requirements["planning"] else True)
        self.assertTrue(requirements["preferences"]["ventilation_priority"] == "high")

    def test_missing_and_ambiguous_values_are_reported(self):
        result = parse_requirements("I need a house for my family.")
        self.assertFalse(result["success"])
        self.assertIn("plot dimensions are required", result["missing"])
        self.assertIn("family_size", result["ambiguities"])
        self.assertIn("bedroom count or BHK is required", result["missing"])

    def test_unknown_style_and_climate_do_not_crash(self):
        result = parse_requirements(
            "A 2 bedroom 30 by 40 east-facing house with custom style: Coastal "
            "and custom climate: Mountain."
        )
        self.assertTrue(result["success"])
        # only the two supported styles exist: an unknown style name is never stored as a style of its own
        self.assertNotEqual(result["requirements"]["preferences"].get("architectural_style"), "Coastal")
        self.assertIn(result["requirements"]["preferences"].get("architectural_style", "Modern Minimalistic"), ("Modern Minimalistic", "Traditional Indian"))
        self.assertEqual(result["requirements"]["preferences"]["climate"], "Mountain")

    def test_invalid_bhk_is_rejected(self):
        result = parse_requirements("A 9 BHK 40 by 50 north-facing house.")
        self.assertFalse(result["success"])
        self.assertTrue(any("between 1 and 8" in warning for warning in result["warnings"]))

    def test_output_schema_and_no_coordinates(self):
        result = parse_requirements(self.EXAMPLE)
        self.assertEqual(set(result), {"success", "requirements", "missing", "ambiguities", "warnings"})

        def assert_no_geometry(value):
            if isinstance(value, dict):
                self.assertFalse({"x", "y", "x2", "y2"}.intersection(value))
                for child in value.values():
                    assert_no_geometry(child)
            elif isinstance(value, list):
                for child in value:
                    assert_no_geometry(child)

        assert_no_geometry(result)
        self.assertTrue(all("room_type" in room for room in result["requirements"]["rooms"]))


if __name__ == "__main__":
    unittest.main()
