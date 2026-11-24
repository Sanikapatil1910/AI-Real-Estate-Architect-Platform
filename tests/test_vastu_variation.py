import unittest
from backend.planner.road_aware_optimizer import road_aware_layout

class VastuVariationTests(unittest.TestCase):
    @unittest.skip("Exercises the retired legacy placer, which still uses the old y-up convention; superseded by tests/test_architect_engine.py")
    def test_vastu_modes_change_geometry(self):
        rooms=[
            {"room_type":"living_room","width":10,"length":10},
            {"room_type":"dining","width":9,"length":9},
            {"room_type":"kitchen","width":8,"length":9},
            {"room_type":"master_bedroom","width":10,"length":11},
            {"room_type":"bedroom","width":9,"length":10},
            {"room_type":"bathroom","width":5,"length":7},
        ]
        plot={"x":3,"y":5,"width":34,"length":42}
        layouts=[road_aware_layout(plot,rooms,"North",strategy="balanced",vastu_mode=m) for m in ("no_preference","basic","strict")]
        signatures=[tuple((r["room_type"],r["x"],r["y"]) for r in l["rooms"]) for l in layouts]
        self.assertEqual(len(set(signatures)),3)
        self.assertTrue(all(l["valid"] for l in layouts))

if __name__ == "__main__":
    unittest.main()
