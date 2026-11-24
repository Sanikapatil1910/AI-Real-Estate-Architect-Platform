import unittest

from backend.planner.road_aware_optimizer import get_road_distance, road_aware_layout
from backend.planner.openings import generate_openings


PLOT = {"x": 3, "y": 5, "width": 34, "length": 42}
ROOMS = [
    {"room_type": "living_room", "width": 12, "length": 13},
    {"room_type": "dining", "width": 10, "length": 10},
    {"room_type": "kitchen", "width": 9, "length": 9},
    {"room_type": "master_bedroom", "width": 11, "length": 12},
    {"room_type": "bedroom", "width": 10, "length": 10},
]


class FrontPublicPlanningTests(unittest.TestCase):
    def test_space_efficient_living_is_front_for_every_road_side(self):
        for road_side in ("North", "South", "East", "West"):
            with self.subTest(road_side=road_side):
                layout = road_aware_layout(
                    PLOT,
                    ROOMS,
                    road_side,
                    strategy="space_efficient",
                    vastu_mode="no_preference",
                )
                living = next(room for room in layout["rooms"] if room["room_type"] == "living_room")
                bedrooms = [room for room in layout["rooms"] if room["room_type"] in {"master_bedroom", "bedroom"}]
                self.assertLessEqual(
                    get_road_distance(living, PLOT, road_side),
                    min(get_road_distance(room, PLOT, road_side) for room in bedrooms),
                )

    def test_front_living_gets_the_main_entrance(self):
        layout = road_aware_layout(PLOT, ROOMS[:1], "East", strategy="space_efficient")
        openings = generate_openings(layout["rooms"], PLOT, "East")
        self.assertTrue(openings["valid"])
        self.assertEqual(openings["entrance"]["room"], "living_room")

    def test_strategy_variation_keeps_front_public_concept_distinct(self):
        layouts = [
            road_aware_layout(PLOT, ROOMS, "North", strategy=strategy)
            for strategy in ("space_efficient", "balanced", "comfort", "luxury")
        ]
        signatures = {
            tuple((room["room_type"], room["x"], room["y"]) for room in layout["rooms"])
            for layout in layouts
        }
        self.assertEqual(len(signatures), 4)
        living_distances = [
            get_road_distance(
                next(room for room in layout["rooms"] if room["room_type"] == "living_room"),
                PLOT,
                "North",
            )
            for layout in layouts
        ]
        self.assertEqual(living_distances[0], 0)
        self.assertEqual(living_distances[0], min(living_distances))


if __name__ == "__main__":
    unittest.main()
