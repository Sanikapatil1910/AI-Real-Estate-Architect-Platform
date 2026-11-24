"""Tests for the architect engine: feasibility, four verified plans, API and rendering."""
import unittest

from fastapi.testclient import TestClient

from backend.main import app
from backend.planner.architect.feasibility import check_request
from backend.planner.architect.service import generate
from backend.planner.architect.verify import verify_plan
from backend.renderer.floorplan_svg import render_floor_plan


def rooms(bhk):
    names = ["living_room", "dining", "kitchen", "utility", "master_bedroom"] \
        + ["bedroom"] * (bhk - 1) + ["bathroom"] * bhk
    return [{"room_type": t} for t in names]


def payload(**kw):
    base = dict(plot_width=30, plot_length=40, road_side="South", building_type="G+1",
                rooms=rooms(3), vastu_mode="basic", balcony_required=True, strict=False)
    base.update(kw)
    return base


class FeasibilityTests(unittest.TestCase):
    def test_too_small_plot_is_rejected_with_suggestion(self):
        r = check_request(payload(plot_width=20, plot_length=30, building_type="Ground"))
        self.assertEqual(r["status"], "infeasible")
        self.assertTrue(r.get("suggestions"))

    def test_comfortable_plot_is_ok(self):
        self.assertEqual(check_request(payload(plot_width=30, plot_length=50,
                                               building_type="Ground"))["status"], "ok")


class FourPlanTests(unittest.TestCase):
    def check(self, **kw):
        p = payload(**kw)
        res = generate(p, budget_s=12)
        self.assertEqual(res["total_plans"], 4)
        floors = {"Ground": 1, "G+1": 2, "G+2": 3}[p["building_type"]]
        for plan in res["plans"]:
            self.assertEqual(len(plan["floors"]), floors)
            self.assertTrue(plan["verification"]["passed"], plan["verification"]["errors"])
            again = verify_plan(plan, p)          # verifier is deterministic and re-runnable
            self.assertTrue(again["passed"])
            self.assertEqual(bool(plan["terrace"]["exists"]), bool(p.get("include_terrace", False)))   # a terrace only when asked for
        self.assertEqual(len({p_["strategy"] for p_ in res["plans"]}), 4)
        return res

    def test_ground_south(self):
        self.check(building_type="Ground", plot_width=30, plot_length=50)

    def test_g1_each_road_side(self):
        for side in ("North", "East"):
            self.check(road_side=side)

    def test_g2_has_balcony_and_same_stair(self):
        res = self.check(building_type="G+2", road_side="West")
        for plan in res["plans"]:
            types = [r["room_type"] for f in plan["floors"] for r in f["layout"]["rooms"]]
            self.assertIn("balcony", types)

    def test_render_does_not_crash(self):
        plan = generate(payload(), budget_s=12)["plans"][0]
        for f in plan["floors"]:
            svg = render_floor_plan(f["layout"], f["layout"]["plot"], f["layout"]["usable_plot"], plan["road_side"])
            self.assertIn("<svg", svg)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_feasibility_endpoint(self):
        r = self.client.post("/feasibility", json=payload(plot_width=20, plot_length=30, building_type="Ground"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "infeasible")

    def test_tight_brief_is_relaxed_not_rejected(self):
        r = self.client.post("/generate/raw", json=payload(plot_width=20, plot_length=30, building_type="Ground"))
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertGreaterEqual(body["total_plans"], 1)
        self.assertFalse(body["relaxation"]["exact"])
        self.assertTrue(body["relaxation"]["adjustments"])
        self.assertTrue(all(p["verification"]["passed"] for p in body["plans"]))

    def test_generate_returns_four_plans(self):
        r = self.client.post("/generate/raw", json=payload())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["total_plans"], 4)


if __name__ == "__main__":
    unittest.main()


def test_balcony_on_every_upper_floor_opens_from_a_room():
    from backend.planner.architect.service import generate
    rooms = [{"room_type": t} for t in ["living_room", "dining", "kitchen", "master_bedroom", "bedroom",
                                          "bedroom", "bathroom", "bathroom", "bathroom"]]
    res = generate(dict(plot_width=30, plot_length=50, road_side="South",
                        setbacks={"front": 5, "rear": 3, "left": 3, "right": 3},
                        building_type="G+2", rooms=rooms, balcony_required=True, strict=False), budget_s=10)
    host = {"bedroom", "master_bedroom", "guest_bedroom", "family_lounge"}
    for pl in res["plans"]:
        gl = pl["floors"][0]["layout"]["rooms"]
        assert sum(1 for f in pl["floors"] for r in f["layout"]["rooms"] if r["room_type"] == "bathroom") == 3, "exactly the 3 bathrooms asked for"
        for fl in pl["floors"][1:]:
            lay = fl["layout"]
            ids = {r["id"]: r["room_type"] for r in lay["rooms"]}
            bal = [r for r in lay["rooms"] if r["room_type"] == "balcony"]
            if not any(t in host for t in ids.values()):
                continue
            assert bal, "balcony missing on an upper floor"
            b = bal[0]["id"]
            assert any((d.get("room") == b and ids.get(d.get("connects_to")) in host) or
                       (d.get("connects_to") == b and ids.get(d.get("room")) in host)
                       for d in lay["openings"]["doors"])


def test_staircase_has_one_entry_end_on_every_floor():
    from backend.planner.architect.service import generate
    rooms = [{"room_type": t} for t in ["living_room", "dining", "kitchen", "master_bedroom", "bedroom", "bedroom", "bathroom", "bathroom"]]
    out = generate(dict(plot_width=35, plot_length=55, road_side="South", building_type="G+1", rooms=rooms,
                        setbacks={"front": 5, "rear": 3, "left": 3, "right": 3}, vastu_mode="basic", strict=False), budget_s=10)
    plan = out["plans"][0]
    from backend.planner.architect.doors import LANDING_DEPTH
    ends = set()
    for fi, fl in enumerate(plan["floors"]):
        lay = fl["layout"]
        st = [r for r in lay["rooms"] if r["room_type"] == "staircase"][0]
        doors = [d for d in lay["openings"]["doors"] if d["room"] == "staircase" or (d.get("connects_to") or "").startswith("staircase")]
        # ground floor: exactly one door.  Upstairs the landing may also open sideways, into the corridor / passage beside the stair
        # (one extra door, within the landing depth of the entry end).
        assert len(doors) == 1 or (fi > 0 and len(doors) == 2)
        along_x = st["width"] >= st["length"]  # stair runs along x: its entry is a short (vertical) wall
        end_doors = [d for d in doors if ((d["x1"] == d["x2"]) if along_x else (d["y1"] == d["y2"]))]
        assert len(end_doors) <= 1 and (fi > 0 or len(end_doors) == 1)
        for d in end_doors:
            ends.add(("x", d["x1"]) if along_x else ("y", d["y1"]))
    assert len(ends) <= 1                      # the entry end is the same wherever the door is on an end wall


def test_parking_reports_cars_and_bikes():
    from backend.planner.architect.service import generate
    rooms = [{"room_type": t} for t in ["living_room", "kitchen", "dining", "master_bedroom", "bedroom", "bedroom", "bathroom", "bathroom", "bathroom"]]
    for typ, cars, bikes in [("2 Cars", 2, 0), ("Car + Bikes", 1, 2)]:
        out = generate(dict(plot_width=35, plot_length=55, road_side="South", building_type="G+1", rooms=rooms,
                            setbacks={"front": 5, "rear": 3, "left": 3, "right": 3}, vastu_mode="basic",
                            parking_required=True, parking_spaces=1 if cars == 1 else 2, parking_type=typ, strict=False), budget_s=10)
        pk = out["plans"][0]["parking"]
        if (pk["cars"], pk["bikes"], pk["type"]) == (cars, bikes, typ):
            continue
        # Every layout must now also pass the circulation checks, which is a much smaller set on a porch frontage this tight.  The ladder may
        # then give up the second bay -- but only openly: the plan must say so and still report what it actually holds.
        adj = " ".join(out.get("relaxation", {}).get("adjustments", []))
        assert typ == "2 Cars" and "reduced to a single car" in adj, (pk, adj)
        assert (pk["cars"], pk["bikes"], pk["type"]) == (1, 0, "1 Car")
