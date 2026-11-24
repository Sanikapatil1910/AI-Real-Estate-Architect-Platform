import unittest

from backend.planner.multi_floor_multi_layout import generate_project_plans
from backend.planner.dimension_engine import ROOM_DIMENSION_RANGES
from backend.planner.plot_rules import create_plot


class MultiPlanTopologyTests(unittest.TestCase):
    def test_four_plans_have_distinct_topologies(self):
        plot_result = create_plot(
            plot_width=40,
            plot_length=50,
            road_side="North",
            front_setback=5,
            rear_setback=3,
            left_setback=3,
            right_setback=3,
        )
        rooms = [
            {"room_type": "living_room"},
            {"room_type": "dining"},
            {"room_type": "kitchen"},
            {"room_type": "utility"},
            {"room_type": "master_bedroom"},
            {"room_type": "bedroom"},
            {"room_type": "guest_bedroom"},
            {"room_type": "bathroom"},
        ]

        result = generate_project_plans(
            rooms=rooms,
            plot=plot_result["plot"],
            usable_plot={
                **plot_result["usable_plot"],
                "x": 3,
                "y": 5,
            },
            building_type="G+1",
            road_side="North",
            number_of_plans=4,
            include_terrace=False,
        )

        self.assertEqual(result["total_plans"], 4)
        signatures = []

        for plan in result["plans"]:
            self.assertIn("topology", plan)
            self.assertTrue(plan["validation"])
            floor_signature = []

            for floor in plan["floors"]:
                layout = floor["layout"]
                rooms_by_type = {
                    room["room_type"]: room
                    for room in layout.get("rooms", [])
                }
                centers = tuple(
                    (
                        room_type,
                        round(room["x"] + room["width"] / 2, 1),
                        round(room["y"] + room["length"] / 2, 1),
                    )
                    for room_type, room in sorted(rooms_by_type.items())
                )
                adjacency = []
                room_values = list(rooms_by_type.values())
                for first_index, first in enumerate(room_values):
                    for second in room_values[first_index + 1:]:
                        if (
                            abs(first["x2"] - second["x"]) <= 0.01
                            or abs(first["x"] - second["x2"]) <= 0.01
                            or abs(first["y2"] - second["y"]) <= 0.01
                            or abs(first["y"] - second["y2"]) <= 0.01
                        ):
                            adjacency.append(tuple(sorted((
                                first["room_type"],
                                second["room_type"],
                            ))))

                open_types = tuple(
                    sorted(
                        region["type"]
                        for region in layout.get("open_spaces", {}).get(
                            "regions",
                            [],
                        )
                    )
                )
                floor_signature.append((
                    floor["floor"],
                    centers,
                    tuple(sorted(adjacency)),
                    open_types,
                ))

                for room in layout.get("rooms", []):
                    limits = ROOM_DIMENSION_RANGES[room["room_type"]]
                    self.assertGreaterEqual(room["width"], limits["min_width"])
                    self.assertLessEqual(room["width"], limits["max_width"])
                    self.assertGreaterEqual(room["length"], limits["min_length"])
                    self.assertLessEqual(room["length"], limits["max_length"])
                    self.assertAlmostEqual(
                        layout["open_spaces"]["remaining_unused_area"],
                        layout["remaining_area"],
                        delta=0.02,
                    )

            signatures.append(tuple(floor_signature))

        self.assertEqual(
            {plan["topology"] for plan in result["plans"]},
            {
                "front_public",
                "side_public",
                "courtyard",
                "central_circulation",
            },
        )
        self.assertEqual(len(set(signatures)), 4)


if __name__ == "__main__":
    unittest.main()
