import unittest

from backend.planner.floor_manager import allocate_rooms_to_floors
from backend.planner.room_connections import get_shared_wall
from backend.planner.staircase_engine import calculate_staircase_for_building
from backend.renderer.floorplan_svg import staircase_svg


class MultiFloorStaircaseBathroomTests(unittest.TestCase):
    def setUp(self):
        self.rooms = [
            {"room_type": room_type}
            for room_type in (
                "living_room", "dining", "kitchen", "guest_bedroom",
                "master_bedroom", "bedroom", "bathroom", "bathroom",
                "staircase",
            )
        ]

    def test_staircase_has_two_opposite_flights_and_landing(self):
        staircase = calculate_staircase_for_building("G+1", 10)
        self.assertEqual(staircase["configuration"], "dog_leg")
        self.assertEqual(staircase["flight_count"], 2)
        self.assertEqual(staircase["flights"][0]["direction"], "up")
        self.assertEqual(staircase["flights"][1]["direction"], "up_reverse")
        self.assertGreater(staircase["landing"]["width_feet"], 0)
        self.assertGreater(staircase["landing"]["depth_feet"], 0)

    def test_staircase_svg_distinguishes_ground_and_arrival(self):
        ground = staircase_svg(0, 0, 84, 168)
        arrival = staircase_svg(0, 0, 84, 168, role="arrival")
        self.assertIn("ARRIVAL", arrival)
        self.assertIn("UP", ground)
        self.assertGreaterEqual(ground.count("stroke=\"#666\""), 10)
        self.assertNotIn("ARRIVAL", ground)

    def test_g_plus_one_allocates_ground_bathroom_and_guest_access(self):
        allocation = allocate_rooms_to_floors(self.rooms, "G+1")
        ground = allocation["Ground Floor"]
        first = allocation["First Floor"]
        ground_bathrooms = [room for room in ground if room["room_type"] == "bathroom"]
        self.assertGreaterEqual(len(ground_bathrooms), 1)
        self.assertEqual(ground_bathrooms[0].get("attached_to"), "guest_bedroom")
        self.assertTrue(any(room.get("staircase_role") == "ground" for room in ground))
        self.assertTrue(any(room.get("staircase_role") == "arrival" for room in first))

    def test_guest_bathroom_and_elderly_bedroom_are_ground_floor(self):
        allocation = allocate_rooms_to_floors(
            self.rooms,
            "G+1",
            family_context={"elderly": 2},
        )
        ground = allocation["Ground Floor"]
        self.assertTrue(any(room["room_type"] == "master_bedroom" for room in ground))
        bathroom = next(room for room in ground if room["room_type"] == "bathroom")
        self.assertEqual(bathroom.get("attached_to"), "guest_bedroom")

    def test_g_plus_two_has_staircase_continuity(self):
        allocation = allocate_rooms_to_floors(self.rooms, "G+2")
        for floor_rooms in allocation.values():
            self.assertTrue(any(room.get("staircase_role") for room in floor_rooms))

    def test_attached_bathroom_contract_is_shared_wall_ready(self):
        bedroom = {"x": 0, "y": 0, "x2": 10, "y2": 10}
        bathroom = {"x": 10, "y": 2, "x2": 16, "y2": 8}
        self.assertIsNotNone(get_shared_wall(bedroom, bathroom))


if __name__ == "__main__":
    unittest.main()
