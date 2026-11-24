import re
import unittest

from backend.ai.requirement_adapter import plan_from_text
from backend.planner.multi_floor_multi_layout import generate_project_plans
from backend.planner.plot_rules import create_plot
from backend.renderer.floorplan_svg import render_floor_plan


class RoadOrientationTests(unittest.TestCase):
    PLOT = {
        "plot_width": 40,
        "plot_length": 50,
        "front_setback": 5,
        "rear_setback": 3,
        "left_setback": 3,
        "right_setback": 3,
    }
    ROOMS = [
        {"room_type": "living_room"},
        {"room_type": "dining"},
        {"room_type": "kitchen"},
        {"room_type": "master_bedroom"},
    ]

    def test_nl_pipeline_preserves_each_canonical_orientation(self):
        for road_side in ("North", "South", "East", "West"):
            with self.subTest(road_side=road_side):
                result = plan_from_text(
                    f"40 by 50 {road_side.lower()}-facing plot "
                    "with a 1 BHK Ground house for a family of two, "
                    "no Vastu, Modern Minimalistic style and Composite climate."
                )
                self.assertEqual(result["total_plans"], 4)
                for plan in result["plans"]:
                    layout = plan["floors"][0]["layout"]
                    self.assertEqual(layout["road_side"], road_side)

                    svg = render_floor_plan(
                        layout,
                        layout["plot"],
                        layout["usable_plot"],
                        layout["road_side"],
                    )
                    road_lines = [
                        line.strip()
                        for line in svg.splitlines()
                        if "ROAD" in line
                    ]
                    self.assertEqual(len(road_lines), 1)
                    self.assertIn(road_side.upper(), road_lines[0])
                    for other_side in ("North", "South", "East", "West"):
                        if other_side != road_side:
                            self.assertNotIn(other_side.upper(), road_lines[0])

    def test_case_variants_normalize_without_changing_orientation(self):
        for road_side in ("North", "South", "East", "West"):
            expected_plot = create_plot(
                road_side=road_side,
                **self.PLOT,
            )
            for variant in (road_side.lower(), road_side.upper()):
                with self.subTest(road_side=road_side, variant=variant):
                    plot_result = create_plot(
                        road_side=variant,
                        **self.PLOT,
                    )
                    self.assertEqual(
                        plot_result["road_side"],
                        expected_plot["road_side"],
                    )
                    result = generate_project_plans(
                        rooms=self.ROOMS,
                        plot=plot_result["plot"],
                        usable_plot={
                            **plot_result["usable_plot"],
                            "x": 3,
                            "y": 5,
                        },
                        building_type="Ground",
                        road_side=variant,
                        number_of_plans=1,
                        include_terrace=False,
                        vastu_mode="no_preference",
                    )
                    layout = result["plans"][0]["floors"][0]["layout"]
                    self.assertEqual(layout["road_side"], expected_plot["road_side"])
