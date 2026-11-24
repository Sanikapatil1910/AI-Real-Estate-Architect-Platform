import unittest
from math import hypot

from backend.planner.open_space_engine import identify_open_spaces
from backend.planner.road_aware_optimizer import (
    get_road_distance,
    road_aware_layout,
)


ROOMS = [
    {"room_type": "living_room", "width": 10, "length": 9},
    {"room_type": "dining", "width": 9, "length": 8},
    {"room_type": "kitchen", "width": 7, "length": 7},
    {"room_type": "utility", "width": 5, "length": 5},
    {"room_type": "master_bedroom", "width": 10, "length": 9},
    {"room_type": "bedroom", "width": 9, "length": 9},
    {"room_type": "bathroom", "width": 5, "length": 5},
    {"room_type": "staircase", "width": 7, "length": 12},
]


class LayoutOptimizerDistributionTests(unittest.TestCase):
    def assert_layout_is_distributed(self, usable_plot, road_side):
        layout = road_aware_layout(
            usable_plot=usable_plot,
            rooms=ROOMS,
            road_side=road_side,
        )

        self.assertTrue(layout["valid"])
        self.assertEqual(len(layout["rooms"]), len(ROOMS))

        for room in layout["rooms"]:
            self.assertGreaterEqual(room["x"], usable_plot["x"])
            self.assertGreaterEqual(room["y"], usable_plot["y"])
            self.assertLessEqual(
                room["x2"],
                usable_plot["x"] + usable_plot["width"],
            )
            self.assertLessEqual(
                room["y2"],
                usable_plot["y"] + usable_plot["length"],
            )

        occupied_portions = set()
        for room in layout["rooms"]:
            center_x = room["x"] + room["width"] / 2
            center_y = room["y"] + room["length"] / 2
            column = min(
                2,
                int(
                    (center_x - usable_plot["x"])
                    / usable_plot["width"]
                    * 3
                ),
            )
            row = min(
                2,
                int(
                    (center_y - usable_plot["y"])
                    / usable_plot["length"]
                    * 3
                ),
            )
            occupied_portions.add((column, row))

        self.assertGreaterEqual(len(occupied_portions), 4)

        open_spaces = identify_open_spaces(
            usable_plot,
            layout["rooms"],
            road_side,
        )
        self.assertGreater(open_spaces["remaining_unused_area"], 0)
        self.assertEqual(
            open_spaces["remaining_unused_area"],
            layout["remaining_area"],
        )

        public_rooms = {
            room["room_type"]: room
            for room in layout["rooms"]
            if room["room_type"] in {"living_room", "dining"}
        }
        self.assertLessEqual(
            get_road_distance(
                public_rooms["living_room"],
                usable_plot,
                road_side,
            ),
            max(usable_plot["width"], usable_plot["length"]) * 0.50,
        )

        room_by_type = {
            room["room_type"]: room
            for room in layout["rooms"]
        }
        dining = room_by_type["dining"]
        kitchen = room_by_type["kitchen"]
        utility = room_by_type["utility"]
        dining_center = (
            dining["x"] + dining["width"] / 2,
            dining["y"] + dining["length"] / 2,
        )
        kitchen_center = (
            kitchen["x"] + kitchen["width"] / 2,
            kitchen["y"] + kitchen["length"] / 2,
        )
        utility_center = (
            utility["x"] + utility["width"] / 2,
            utility["y"] + utility["length"] / 2,
        )
        self.assertLessEqual(hypot(
            dining_center[0] - kitchen_center[0],
            dining_center[1] - kitchen_center[1],
        ), 12)
        self.assertLessEqual(hypot(
            kitchen_center[0] - utility_center[0],
            kitchen_center[1] - utility_center[1],
        ), 12)

        staircase = room_by_type["staircase"]
        plot_center = (
            usable_plot["x"] + usable_plot["width"] / 2,
            usable_plot["y"] + usable_plot["length"] / 2,
        )
        staircase_center = (
            staircase["x"] + staircase["width"] / 2,
            staircase["y"] + staircase["length"] / 2,
        )
        self.assertLessEqual(hypot(
            staircase_center[0] - plot_center[0],
            staircase_center[1] - plot_center[1],
        ), hypot(
            usable_plot["width"],
            usable_plot["length"],
        ) * 0.5)

    def test_40_by_50_north_road(self):
        self.assert_layout_is_distributed(
            {
                "x": 3,
                "y": 5,
                "width": 34,
                "length": 42,
            },
            "North",
        )

    def test_30_by_60_east_road(self):
        self.assert_layout_is_distributed(
            {
                "x": 2,
                "y": 4,
                "width": 26,
                "length": 53,
            },
            "East",
        )

    def test_30_by_60_south_road(self):
        self.assert_layout_is_distributed(
            {
                "x": 2,
                "y": 4,
                "width": 26,
                "length": 53,
            },
            "South",
        )


if __name__ == "__main__":
    unittest.main()
