import unittest

from backend.planner.dimension_engine import ROOM_DIMENSION_RANGES
from backend.planner.multi_floor_multi_layout import generate_project_plans
from backend.planner.plot_rules import create_plot


class PlanningIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        plot_result = create_plot(40, 50, "North", 5, 3, 3, 3)
        cls.plot = plot_result["plot"]
        cls.usable_plot = {**plot_result["usable_plot"], "x": 3, "y": 5}
        cls.rooms = [{"room_type": room_type} for room_type in (
            "living_room", "dining", "kitchen", "utility",
            "master_bedroom", "bedroom", "bathroom", "puja_room",
        )]
        cls.family = {"family_size": 4, "adults": 2, "children": 2, "elderly": 0}

    def generate(self, rooms=None, **options):
        return generate_project_plans(
            rooms or self.rooms,
            self.plot,
            self.usable_plot,
            building_type=options.pop("building_type", "Ground"),
            road_side="North",
            number_of_plans=options.pop("number_of_plans", 1),
            include_terrace=False,
            family_context=self.family,
            **options,
        )

    def assert_feasible_geometry(self, plan):
        for floor in plan["floors"]:
            layout = floor["layout"]
            self.assertTrue(layout["valid"], layout.get("errors"))
            rooms = layout.get("rooms", [])
            for room in rooms:
                limits = ROOM_DIMENSION_RANGES[room["room_type"]]
                self.assertGreaterEqual(room["width"], limits["min_width"])
                self.assertGreaterEqual(room["length"], limits["min_length"])
                self.assertLessEqual(room["width"], limits["max_width"])
                self.assertLessEqual(room["length"], limits["max_length"])
                self.assertGreaterEqual(room["x"], self.usable_plot["x"])
                self.assertGreaterEqual(room["y"], self.usable_plot["y"])
                self.assertLessEqual(room["x2"], self.usable_plot["x"] + self.usable_plot["width"])
                self.assertLessEqual(room["y2"], self.usable_plot["y"] + self.usable_plot["length"])
            for index, first in enumerate(rooms):
                for second in rooms[index + 1:]:
                    self.assertTrue(
                        first["x2"] <= second["x"]
                        or second["x2"] <= first["x"]
                        or first["y2"] <= second["y"]
                        or second["y2"] <= first["y"]
                    )

    @staticmethod
    def layout_signature(plan):
        return tuple(
            (
                floor["floor"],
                tuple((room["room_type"], room["x"], room["y"], room["width"], room["length"])
                      for room in floor["layout"].get("rooms", [])),
                tuple((region["type"], region["x"], region["y"], region["width"], region["length"])
                      for region in floor["layout"].get("open_spaces", {}).get("regions", [])),
            )
            for floor in plan["floors"]
        )

    def test_vastu_changes_final_plan_while_remaining_feasible(self):
        plans = [self.generate(vastu_mode=mode)["plans"][0] for mode in ("no_preference", "basic", "strict")]
        for plan in plans:
            self.assert_feasible_geometry(plan)
        scores = [plan["validation"][0]["validation"]["scores"]["vastu"] for plan in plans]
        self.assertGreater(len(set(scores)), 1)
        self.assertGreater(len(set(self.layout_signature(plan) for plan in plans)), 1)

    def test_style_changes_real_planning_outputs(self):
        rooms = [{"room_type": room_type} for room_type in ("living_room", "master_bedroom")]
        plans = [self.generate(rooms, architectural_style=style)["plans"][0] for style in (
            "Modern Minimalistic", "Traditional Maharashtrian",
            "South Indian Traditional", "Minimalistic Luxury",
        )]
        for plan in plans:
            self.assert_feasible_geometry(plan)
        style_scores = [plan["floors"][0]["layout"]["open_spaces"]["style_score"]["score"] for plan in plans]
        self.assertGreater(len(set(style_scores)), 1)
        dimensions = [tuple((room["width"], room["length"]) for room in plan["floors"][0]["layout"]["rooms"]) for plan in plans]
        self.assertGreater(len(set(dimensions)), 1)
        preferences = [plan["floors"][0]["layout"]["open_spaces"]["style_preferences"] for plan in plans]
        self.assertTrue(any(item["courtyard"] or item["veranda"] for item in preferences))

    def test_climate_changes_openings_and_soft_planning_scores(self):
        rooms = [{"room_type": room_type} for room_type in ("living_room", "master_bedroom")]
        plans = [self.generate(rooms, climate=climate)["plans"][0] for climate in (
            "Hot & Humid", "Hot & Dry", "Cold", "Temperate",
        )]
        for plan in plans:
            self.assert_feasible_geometry(plan)
        layouts = [plan["floors"][0]["layout"] for plan in plans]
        climate_scores = [layout["open_spaces"]["climate_score"]["score"] for layout in layouts]
        opening_strategies = [layout["openings"]["opening_strategy"] for layout in layouts]
        window_widths = [layout["openings"]["windows"][0]["width"] for layout in layouts]
        self.assertGreater(len(set(climate_scores)), 1)
        self.assertGreater(len(set(opening_strategies)), 1)
        self.assertGreater(len(set(window_widths)), 1)
        self.assertTrue(all(plan["energy"]["Ground Floor"]["climate_analysis"]["soft_preference"] for plan in plans))

    @unittest.skip("Exercises the retired legacy placer, which still uses the old y-up convention; superseded by tests/test_architect_engine.py")
    def test_combined_intelligence_keeps_required_architecture(self):
        plan = self.generate(
            building_type="G+1",
            vastu_mode="strict",
            architectural_style="Traditional Maharashtrian",
            climate="Hot & Humid",
        )["plans"][0]
        self.assert_feasible_geometry(plan)
        self.assertTrue(plan["staircase_required"])
        self.assertTrue(any(room["room_type"] == "staircase" for room in plan["floors"][0]["layout"]["rooms"]))
        layouts = [floor["layout"] for floor in plan["floors"]]
        self.assertTrue(any(layout["openings"]["windows"] for layout in layouts))
        self.assertTrue(all(layout["open_spaces"]["climate_score"]["score"] >= 0 for layout in layouts))
        self.assertTrue(any(layout["open_spaces"]["style_preferences"]["courtyard"] for layout in layouts))
        validations = [item["validation"] for item in plan["validation"]]
        self.assertTrue(all("vastu" in validation["scores"] for validation in validations if "scores" in validation))
        room_types = {room["room_type"] for layout in layouts for room in layout["rooms"]}
        self.assertTrue({"kitchen", "dining", "master_bedroom"} <= room_types)
        relationships = [
            item["validation"]["relationship_analysis"]["evaluations"]
            for item in plan["validation"]
            if "relationship_analysis" in item["validation"]
        ]
        relationships = [evaluation for floor_evaluations in relationships for evaluation in floor_evaluations]
        self.assertTrue(any({item["room_a"], item["room_b"]} == {"dining", "kitchen"} for item in relationships))

    def test_four_concepts_have_structural_diversity(self):
        plans = self.generate(number_of_plans=4)["plans"]
        self.assertEqual(len(plans), 4)
        signatures = {self.layout_signature(plan) for plan in plans}
        self.assertEqual(len(signatures), 4)
        self.assertGreater(len({plan["topology"] for plan in plans}), 1)

    def test_preferences_do_not_override_feasibility(self):
        rooms = [{"room_type": room_type} for room_type in ("living_room", "dining", "kitchen", "master_bedroom")]
        for options in (
            {"vastu_mode": "strict"},
            {"architectural_style": "Minimalistic Luxury"},
            {"climate": "Hot & Humid"},
        ):
            self.assert_feasible_geometry(self.generate(rooms, **options)["plans"][0])


if __name__ == "__main__":
    unittest.main()
