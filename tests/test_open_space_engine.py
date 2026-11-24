import unittest

from backend.planner.open_space_engine import identify_open_spaces
from backend.planner.multi_floor_generator import generate_floor_layouts


class OpenSpaceEngineTests(unittest.TestCase):
    def test_40_by_50_layout_preserves_open_area(self):
        usable_plot = {
            "x": 3,
            "y": 5,
            "width": 34,
            "length": 42,
        }
        rooms = [
            {
                "room_type": "living_room",
                "x": 3,
                "y": 32,
                "width": 12,
                "length": 10,
            },
            {
                "room_type": "dining",
                "x": 15,
                "y": 32,
                "width": 10,
                "length": 8,
            },
            {
                "room_type": "kitchen",
                "x": 3,
                "y": 22,
                "width": 8,
                "length": 8,
            },
            {
                "room_type": "staircase",
                "x": 27,
                "y": 5,
                "width": 7,
                "length": 15,
            },
        ]

        result = identify_open_spaces(usable_plot, rooms, "North")

        self.assertTrue(result["valid"])
        self.assertEqual(result["total_usable_area"], 1428)
        self.assertEqual(result["occupied_room_area"], 369)
        self.assertEqual(result["remaining_unused_area"], 1059)
        self.assertGreater(len(result["regions"]), 1)
        self.assertTrue(result["regions_by_type"]["front_open_space"])
        self.assertTrue(result["regions_by_type"]["rear_open_space"])
        self.assertTrue(result["setbacks_excluded"])

        region_area = sum(region["area"] for region in result["regions"])
        self.assertEqual(region_area, result["remaining_unused_area"])

    def test_generated_floor_layout_contains_open_spaces(self):
        usable_plot = {
            "x": 3,
            "y": 5,
            "width": 34,
            "length": 42,
            "area": 1428,
        }
        building = generate_floor_layouts(
            rooms=[
                {
                    "room_type": "living_room",
                    "width": 12,
                    "length": 10,
                },
                {
                    "room_type": "dining",
                    "width": 10,
                    "length": 8,
                },
            ],
            plot={"width": 40, "length": 50},
            usable_plot=usable_plot,
            building_type="G+1",
            road_side="North",
            include_terrace=False,
        )

        for floor in building["floors"]:
            layout = floor["layout"]

            self.assertIn("rooms", layout)
            self.assertIn("used_room_area", layout)
            self.assertIn("remaining_area", layout)
            self.assertIn("open_spaces", layout)
            self.assertEqual(
                layout["open_spaces"]["remaining_unused_area"],
                layout["remaining_area"],
            )

            for region in layout["open_spaces"]["regions"]:
                self.assertGreaterEqual(region["x"], usable_plot["x"])
                self.assertGreaterEqual(region["y"], usable_plot["y"])
                self.assertLessEqual(
                    region["x"] + region["width"],
                    usable_plot["x"] + usable_plot["width"],
                )
                self.assertLessEqual(
                    region["y"] + region["length"],
                    usable_plot["y"] + usable_plot["length"],
                )


if __name__ == "__main__":
    unittest.main()
