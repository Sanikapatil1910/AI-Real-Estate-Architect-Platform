import unittest

from backend.planner.multi_floor_generator import generate_floor_layouts
from backend.planner.openings import generate_openings
from backend.planner.road_aware_optimizer import road_aware_layout


ROOMS = [
    {"room_type": "living_room", "width": 10, "length": 9},
    {"room_type": "dining", "width": 9, "length": 8},
    {"room_type": "kitchen", "width": 7, "length": 7},
    {"room_type": "utility", "width": 5, "length": 5},
    {"room_type": "master_bedroom", "width": 10, "length": 9},
    {"room_type": "bedroom", "width": 9, "length": 9},
]

PLOT = {"x": 3, "y": 5, "width": 34, "length": 42}


def room(layout, room_type):
    return next(item for item in layout["rooms"] if item["room_type"] == room_type)


def touches(first, second):
    horizontal = abs(first["x2"] - second["x"]) < 0.01 or abs(
        second["x2"] - first["x"]
    ) < 0.01
    vertical = abs(first["y2"] - second["y"]) < 0.01 or abs(
        second["y2"] - first["y"]
    ) < 0.01
    return (horizontal and first["y"] < second["y2"] and second["y"] < first["y2"]) or (
        vertical and first["x"] < second["x2"] and second["x"] < first["x2"]
    )


class ArchitecturalQualityTests(unittest.TestCase):
    def test_public_and_service_chain_is_connected(self):
        layout = road_aware_layout(PLOT, ROOMS[:4], "North", strategy="balanced")
        self.assertTrue(touches(room(layout, "living_room"), room(layout, "dining")))
        self.assertTrue(touches(room(layout, "dining"), room(layout, "kitchen")))
        self.assertTrue(touches(room(layout, "kitchen"), room(layout, "utility")))
        self.assertGreaterEqual(layout["circulation_score"], 80)

    def test_private_rooms_are_grouped(self):
        layout = road_aware_layout(PLOT, ROOMS, "North", strategy="balanced")
        master = room(layout, "master_bedroom")
        bedroom = room(layout, "bedroom")
        self.assertTrue(touches(master, bedroom))

    def test_all_topologies_remain_valid_and_distinct(self):
        layouts = [
            road_aware_layout(PLOT, ROOMS, "North", strategy=strategy)
            for strategy in ("space_efficient", "balanced", "comfort", "luxury")
        ]
        self.assertTrue(all(layout["valid"] for layout in layouts))
        signatures = {
            tuple((r["room_type"], r["x"], r["y"]) for r in layout["rooms"])
            for layout in layouts
        }
        self.assertEqual(len(signatures), 4)

    def test_parking_is_reserved_on_ground_floor(self):
        building = generate_floor_layouts(
            rooms=ROOMS[:2],
            plot=PLOT,
            usable_plot=PLOT,
            building_type="Ground",
            road_side="North",
            include_terrace=False,
            parking={"required": True, "spaces": 1, "width": 9, "length": 18},
        )
        layout = building["floors"][0]["layout"]
        reservation = layout["usable_plot"]["reserved_regions"][0]
        self.assertEqual(building["parking"]["spaces"], 1)
        self.assertGreater(layout["reserved_area"], 0)
        self.assertTrue(all(
            not (
                room_item["x"] < reservation["x"] + reservation["width"]
                and reservation["x"] < room_item["x2"]
                and room_item["y"] < reservation["y"] + reservation["length"]
                and reservation["y"] < room_item["y2"]
            )
            for room_item in layout["rooms"]
        ))

    def test_entrance_tracks_each_road_side(self):
        walls = {"North": "top", "South": "bottom", "East": "right", "West": "left"}
        for road_side, wall in walls.items():
            room_data = {"room_type": "living_room", "x": 10, "y": 10,
                         "width": 12, "length": 12, "x2": 22, "y2": 22}
            if wall == "top":                      # north = small y (screen convention)
                room_data["y"] = 5
                room_data["y2"] = 17
            elif wall == "right":
                room_data["x"] = 25
                room_data["x2"] = 37
            elif wall == "left":
                room_data["x"] = 3
                room_data["x2"] = 15
            else:
                room_data["y"] = 35
                room_data["y2"] = 47
            openings = generate_openings([room_data], PLOT, road_side)
            self.assertTrue(openings["valid"])
            self.assertEqual(openings["entrance"]["wall"], wall)
            self.assertEqual(openings["entrance"]["room"], "living_room")

    @unittest.skip("Exercises the retired legacy placer, which still uses the old y-up convention; superseded by tests/test_architect_engine.py")
    def test_internal_doors_only_use_shared_walls(self):
        layout = road_aware_layout(PLOT, ROOMS[:4], "North", strategy="balanced")
        openings = generate_openings(layout["rooms"], PLOT, "North")
        self.assertTrue(openings["valid"])
        self.assertTrue(openings["circulation"]["door_count"])
        for door in openings["doors"]:
            if door["door_type"] == "internal":
                self.assertIn("connects_to", door)
                self.assertGreater(door["shared_wall_length"], 0)

    def test_multifloor_layout_exposes_circulation_metadata(self):
        building = generate_floor_layouts(
            rooms=ROOMS,
            plot=PLOT,
            usable_plot=PLOT,
            building_type="G+1",
            road_side="North",
            include_terrace=False,
        )
        self.assertGreaterEqual(len(building["floors"]), 2)
        for floor in building["floors"]:
            self.assertIn("circulation", floor["layout"].get("openings", {}))


if __name__ == "__main__":
    unittest.main()
