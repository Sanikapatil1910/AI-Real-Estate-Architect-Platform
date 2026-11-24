import unittest

from backend.ai.requirement_adapter import (
    RequirementAdapterError,
    build_planner_request,
    plan_from_text,
)
from backend.ai.requirement_parser import parse_requirements


class RequirementAdapterTests(unittest.TestCase):
    EXAMPLE = (
        "I have a 40 by 50 north-facing plot. I want a 3 BHK G+1 house "
        "for a family of four. My elderly parents should have a bedroom on "
        "the ground floor. I want strict Vastu, traditional Maharashtrian "
        "style and good ventilation because the climate is hot and humid."
    )

    def test_builds_planner_request_from_natural_language(self):
        parsed = parse_requirements(self.EXAMPLE)
        request = build_planner_request(parsed["requirements"])
        self.assertEqual(request["plot"]["width"], 40.0)
        self.assertEqual(request["plot"]["length"], 50.0)
        self.assertEqual(request["road_side"], "North")
        self.assertEqual(request["building_type"], "G+1")
        self.assertEqual(request["vastu_mode"], "strict")
        self.assertEqual(request["architectural_style"], "Traditional Indian")
        self.assertEqual(request["climate"], "Hot & Humid")
        self.assertTrue(request["family_context"]["ground_floor_master_required"])
        self.assertEqual(request["family_context"]["elderly"], 2)
        self.assertTrue(all(set(room) == {"room_type"} for room in request["rooms"]))

    def test_plan_from_text_reaches_existing_planner(self):
        result = plan_from_text(self.EXAMPLE)
        self.assertEqual(result["total_plans"], 4)
        self.assertTrue(result["plans"])
        ground_rooms = result["plans"][0]["floors"][0]["layout"]["rooms"]
        self.assertTrue(any(room["room_type"] == "master_bedroom" for room in ground_rooms))
        self.assertTrue(result["plans"][0]["validation"])
        self.assertEqual(result["plans"][0]["architectural_style"], "Traditional Indian")
        self.assertEqual(result["plans"][0]["energy"]["Ground Floor"]["climate"], "Hot and Humid")
        self.assertIn("vastu", result["plans"][0]["validation"][0]["validation"]["scores"])

    def test_missing_dimensions_are_rejected_before_planning(self):
        result = plan_from_text("I need a 3 BHK north-facing family home.")
        self.assertFalse(result["success"])
        self.assertIn("plot dimensions are required", result["missing"])

    def test_invalid_bhk_is_rejected(self):
        result = plan_from_text("I need a 9 BHK 40 by 50 north-facing house.")
        self.assertFalse(result["success"])
        self.assertTrue(result["warnings"])

    def test_adapter_rejects_invalid_planner_values(self):
        requirements = parse_requirements("A 3 BHK 40 by 50 north-facing house.")["requirements"]
        requirements["house"]["building_type"] = "G+9"
        with self.assertRaises(RequirementAdapterError):
            build_planner_request(requirements)

    def test_meter_dimensions_and_parking_are_adapted(self):
        parsed = parse_requirements("A 10 by 20 meter 2 BHK villa with parking for two cars.")
        request = build_planner_request(parsed["requirements"])
        self.assertAlmostEqual(request["plot"]["width"], 32.8084, places=3)
        self.assertEqual(request["building_type"], "Villa")
        self.assertTrue(request["parking_required"])
        self.assertEqual(request["parking_spaces"], 2)

    def test_ai_layer_does_not_create_room_geometry(self):
        parsed = parse_requirements(self.EXAMPLE)
        request = build_planner_request(parsed["requirements"])
        for room in request["rooms"]:
            self.assertNotIn("x", room)
            self.assertNotIn("y", room)
            self.assertNotIn("x2", room)
            self.assertNotIn("y2", room)


if __name__ == "__main__":
    unittest.main()
