import unittest
from backend.planner.dimension_engine import generate_room_dimensions
from backend.planner.openings import generate_openings

class StyleAndOpeningsTests(unittest.TestCase):
    def test_style_changes_room_dimensions(self):
        rooms=[{"room_type":"living_room"},{"room_type":"master_bedroom"}]
        a=generate_room_dimensions(rooms, strategy="balanced", floor_area=1400, style="Modern Minimalistic")
        b=generate_room_dimensions(rooms, strategy="balanced", floor_area=1400, style="Traditional Indian")
        self.assertNotEqual([(r["width"],r["length"]) for r in a], [(r["width"],r["length"]) for r in b])

    def test_openings_are_generated_for_boundary_rooms(self):
        rooms=[{"room_type":"living_room","x":3,"y":5,"width":12,"length":10,"x2":15,"y2":15}]
        result=generate_openings(rooms, {"x":3,"y":5,"width":34,"length":42}, "North")
        self.assertTrue(result["valid"])
        self.assertEqual(result["entrance"]["room"], "living_room")
        self.assertTrue(result["windows"])

if __name__=="__main__": unittest.main()
