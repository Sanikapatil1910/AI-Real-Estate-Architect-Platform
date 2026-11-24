import unittest

from backend.planner.floor_manager import allocate_rooms_to_floors
from backend.planner.multi_floor_generator import generate_floor_layouts
from backend.planner.requirement_engine import create_room_requirements
from backend.planner.validator import validate_bedroom_program, validate_master_bathroom


PLOT = {"width": 40, "length": 50}
USABLE = {"x": 3, "y": 5, "width": 34, "length": 42, "area": 1428}


class FunctionalPlanningTests(unittest.TestCase):
    def test_bhk_program_contains_master_and_additional_bedroom(self):
        rooms = create_room_requirements(bhk=3)
        self.assertEqual(
            [room["room_type"] for room in rooms].count("master_bedroom"),
            1,
        )
        self.assertEqual(
            [room["room_type"] for room in rooms].count("bedroom"),
            2,
        )
        self.assertTrue(validate_bedroom_program(rooms, 3)["valid"])
        self.assertFalse(validate_bedroom_program([{"room_type": "master_bedroom"}], 2)["valid"])

    def test_master_bathroom_contract_requires_shared_wall(self):
        master = {"room_type": "master_bedroom", "x": 0, "y": 0, "x2": 10, "y2": 12}
        bathroom = {"room_type": "bathroom", "x": 10, "y": 2, "x2": 16, "y2": 8}
        self.assertTrue(validate_master_bathroom([master, bathroom], True)["valid"])
        bathroom["x"] = 20
        bathroom["x2"] = 26
        self.assertFalse(validate_master_bathroom([master, bathroom], True)["valid"])

    def test_multi_floor_functionality_preserves_ground_bathroom_guest_and_stairs(self):
        rooms = [
            {"room_type": room_type}
            for room_type in (
                "living_room", "dining", "kitchen", "utility",
                "guest_bedroom", "master_bedroom", "bedroom",
                "bathroom", "bathroom", "staircase",
            )
        ]
        allocation = allocate_rooms_to_floors(rooms, "G+1", {"elderly": 2})
        ground = allocation["Ground Floor"]
        self.assertTrue(any(room["room_type"] == "bathroom" for room in ground))
        self.assertTrue(any(room["room_type"] == "guest_bedroom" for room in ground))
        self.assertTrue(any(room.get("staircase_role") == "ground" for room in ground))
        self.assertTrue(any(room.get("staircase_role") == "arrival" for room in allocation["First Floor"]))

    def test_balcony_and_garden_have_real_contained_geometry(self):
        building = generate_floor_layouts(
            rooms=[
                {"room_type": "living_room", "width": 12, "length": 14},
                {"room_type": "master_bedroom", "width": 11, "length": 12},
                {"room_type": "bedroom", "width": 10, "length": 10},
            ],
            plot=PLOT,
            usable_plot=USABLE,
            building_type="G+1",
            road_side="North",
            include_terrace=True,
            balcony_required=True,
            garden_required=True,
            terrace_features={"solar_panels": True, "terrace_garden": True},
        )
        ground = building["floors"][0]["layout"]
        first = building["floors"][1]["layout"]
        garden = ground["garden"]
        balcony = first["balcony"]
        self.assertTrue(garden["exists"])
        self.assertTrue(balcony["exists"])
        for region in (garden, balcony):
            self.assertGreater(region["width"], 0)
            self.assertGreater(region["length"], 0)
            self.assertGreaterEqual(region["x"], USABLE["x"])
            self.assertGreaterEqual(region["y"], USABLE["y"])
            self.assertLessEqual(region["x"] + region["width"], USABLE["x"] + USABLE["width"])
            self.assertLessEqual(region["y"] + region["length"], USABLE["y"] + USABLE["length"])
        terrace = building["terrace"]
        self.assertTrue(terrace["exists"])
        self.assertIsNotNone(terrace["solar_panels"])
        self.assertIsNotNone(terrace["garden"])


if __name__ == "__main__":
    unittest.main()
