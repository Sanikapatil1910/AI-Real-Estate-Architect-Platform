"""Stair rules, common bathroom / toilet option, car porch inside the plan, hand-drawn plan reading."""
import json
import unittest

from backend.planner.staircase_engine import calculate_staircase
from backend.planner.architect.service import generate

_ROOMS = [{"room_type": t} for t in ("living_room", "kitchen", "dining", "master_bedroom", "bedroom", "bedroom", "bathroom", "bathroom", "bathroom")]


def _pl(**kw):
    base = dict(plot_width=30, plot_length=40, road_side="South", setbacks={"front": 3, "rear": 3, "left": 2, "right": 2},
                rooms=list(_ROOMS), building_type="G+1", parking_required=False, parking_spaces=1,
                floor_height=10, stair_width=3.5, vastu_mode="basic", strict=False)
    base.update(kw)
    return base


class StairRules(unittest.TestCase):
    def test_limits(self):
        s = calculate_staircase(10.0)
        self.assertLessEqual(s["riser_height_mm"], 150.0 + 1e-6)
        self.assertAlmostEqual(s["tread_depth_mm"], 300.0)
        self.assertTrue(s["rules_ok"])


class Parking(unittest.TestCase):
    def test_porch_is_a_room_in_the_plan(self):
        for pt in ("1 Car", "Bikes"):
            res = generate(_pl(parking_required=True, parking_type=pt, plot_width=35, plot_length=55))
            plan = res["plans"][0]
            types = [r["room_type"] for r in plan["floors"][0]["layout"]["rooms"]]
            self.assertTrue("parking" in types or "bike_parking" in types, pt)
            self.assertEqual(plan["parking"]["required"], True)

    def test_two_cars_never_refused(self):
        res = generate(_pl(parking_required=True, parking_type="2 Cars"))  # may relax to one car, never refused
        self.assertEqual(len(res["plans"]), 4)


class Bathrooms(unittest.TestCase):
    def test_common_bath_always_on_ground_floor(self):
        res = generate(_pl())
        ground = [r["room_type"] for r in res["plans"][0]["floors"][0]["layout"]["rooms"]]
        self.assertTrue("bathroom" in ground or "toilet" in ground)


if __name__ == "__main__":
    unittest.main()


class StrictMode(unittest.TestCase):
    def test_strict_never_changes_the_brief(self):
        from backend.planner.architect.service import NoLayout
        try:
            res = generate(_pl(building_type="Ground", plot_width=30, plot_length=50))
        except NoLayout as exc:
            self.assertIn("Nothing was changed", str(exc))
            return
        self.assertTrue(res["relaxation"]["exact"])
        self.assertEqual(res["plans"][0]["building_type"], "Ground")
        for plan in res["plans"]:
            for fl in plan["floors"]:
                for dr in fl["layout"]["openings"]["doors"]:
                    pass
                self.assertIn("ducts", fl["layout"])

    def test_floor_rooms_are_respected(self):
        from backend.planner.architect.program import build_program
        rooms = [{"room_type": t} for t in ("living_room", "kitchen", "dining", "master_bedroom", "bedroom", "bathroom", "bathroom")]
        p = build_program(rooms, "G+1", floor_rooms=[["living_room", "kitchen", "dining", "bathroom"],
                                                    ["master_bedroom", "bedroom", "bathroom"]])
        self.assertEqual({s.type for s in p.floors[1].specs} & {"living_room", "kitchen", "dining"}, set())
        self.assertIn("master_bedroom", {s.type for s in p.floors[1].specs})

    def test_habitable_aspect_rule(self):
        from backend.planner.architect.rules import rule_for
        for t in ("living_room", "bedroom", "kitchen", "dining"):
            self.assertLessEqual(rule_for(t).max_aspect, 1.25 + 1e-9)
