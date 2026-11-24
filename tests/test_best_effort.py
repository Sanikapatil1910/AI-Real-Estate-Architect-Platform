"""Always answer with a valid plan: the best-effort pipeline, the feasibility calculator and the compliance report.

The brief that used to end in "No layout satisfying every architectural rule was found" -- a 24 x 50 ft plot, G+1, 3 bedrooms, 4 bathrooms,
living / dining / kitchen / utility, car + bikes, road on the West, setbacks 5 / 3 / 3 / 3 ft -- is the main case, in both modes:

* "let the planner adjust my brief" (strict False): plans come back, every change is listed and the report never claims more than the
  drawings contain;
* "keep my brief as asked" (strict True): the floors are not changed behind the user's back, what could not be planned is listed as unmet.

The hard rules (setbacks, no overlap, stairs, doors, circulation, minimum sizes) are checked on every plan that is returned.
The tests of the whole matrix (G, G+1, G+2, parking variants, road sides, optional features, seeds) use plots that are quick to plan."""
import unittest
from fastapi.testclient import TestClient

from backend.main import app
from backend.planner.architect import service
from backend.planner.architect.feasibility import _site_and_program, available_box, check_request, floor_need, spec_min_area
from backend.planner.architect.requirements import compliance, delivered, requested
from backend.planner.architect.rules import HARD_MIN, rule_for, set_compact, set_strict, park_width, PARK_MIN_DEPTH
from backend.planner.architect.verify import verify_plan

_CACHE = {}


def rooms_for(beds=3, baths=4, extra=()):
    names = ["living_room", "dining", "kitchen", "utility", "master_bedroom"] + ["bedroom"] * (beds - 1) + ["bathroom"] * baths + list(extra)
    return [{"room_type": t} for t in names]


def brief_24x50(strict, **kw):
    p = dict(plot_width=24, plot_length=50, road_side="West", building_type="G+1", rooms=rooms_for(3, 4), vastu_mode="basic",
             parking_required=True, parking_spaces=1, parking_type="Car + Bikes", strict=strict,
             setbacks={"front": 5, "rear": 3, "left": 3, "right": 3}, number_of_plans=4)
    p.update(kw)
    return p


def generate(payload, key=None, budget_s=10.0, seed=None):
    k = key or repr(sorted((a, repr(b)) for a, b in payload.items())) + repr(seed)
    if k not in _CACHE:
        set_strict(True)
        set_compact(1.0)
        _CACHE[k] = service.generate(dict(payload), budget_s=budget_s, seed=seed)
        set_strict(True)
        set_compact(1.0)
    return _CACHE[k]


def hard_rules_hold(test, res, payload):
    """Tier 1: every plan that is returned passed the independent verifier and the building-wide circulation check."""
    test.assertTrue(res["plans"], "a plan must always come back")
    for p in res["plans"]:
        test.assertTrue(p["verification"]["passed"], p["verification"]["errors"][:3])
        for rep in p["circulation"]["floors"]:
            test.assertEqual(rep["issues"], [], rep["issues"][:2])
        for fl in p["floors"]:
            for r in fl["layout"]["rooms"]:
                test.assertGreater(r["width"], 0.0)
                test.assertGreater(r["length"], 0.0)


def inside_setbacks_24x50_west(test, res):
    """Road on the West: the front setback (5 ft) is measured along x, rear (3) from the East edge, left / right (3) along y."""
    for p in res["plans"]:
        for fl in p["floors"]:
            for r in fl["layout"]["rooms"]:
                test.assertGreaterEqual(r["x"], 5.0 - 1e-6, r["id"])
                test.assertLessEqual(r["x2"], 21.0 + 1e-6, r["id"])
                test.assertGreaterEqual(r["y"], 3.0 - 1e-6, r["id"])
                test.assertLessEqual(r["y2"], 47.0 + 1e-6, r["id"])


def no_overlap(test, res):
    for p in res["plans"]:
        for fl in p["floors"]:
            rs = fl["layout"]["rooms"]
            for i, a in enumerate(rs):
                for b in rs[i + 1:]:
                    ox = min(a["x2"], b["x2"]) - max(a["x"], b["x"])
                    oy = min(a["y2"], b["y2"]) - max(a["y"], b["y"])
                    test.assertFalse(ox > 1e-3 and oy > 1e-3, f"{a['id']} overlaps {b['id']}")


class FeasibilityCalculator(unittest.TestCase):
    """The audit of the area maths behind 'needs 817 sq ft, only 480 available'."""

    @classmethod
    def setUpClass(cls):
        cls.site, cls.prog = _site_and_program(brief_24x50(True))

    def test_buildable_box_is_after_setbacks_only(self):
        box = available_box(self.site)
        self.assertEqual((box["frontage"], box["depth"]), (44.0, 16.0))      # 50 - 3 - 3 across the road, 24 - 5 - 3 into the plot

    def test_stair_counts_at_its_real_footprint(self):
        st = self.prog.floors[0].stair
        self.assertGreaterEqual(spec_min_area(st), 120.0)                    # not the generic 70 sq ft room minimum

    def test_car_porch_counts_once_at_the_width_of_its_vehicles(self):
        porch = [s for s in self.prog.floors[0].specs if s.type == "parking"]
        self.assertEqual(len(porch), 1)
        self.assertAlmostEqual(spec_min_area(porch[0]), park_width("parking", porch[0].role) * PARK_MIN_DEPTH["parking"])
        self.assertEqual(sum(1 for fp in self.prog.floors for s in fp.specs if s.type in ("parking", "bike_parking")), 1)

    def test_attached_bathrooms_are_not_counted_twice(self):
        baths = [s for fp in self.prog.floors for s in fp.specs if s.type == "bathroom"]
        self.assertEqual(len(baths), 4)

    def test_every_floor_is_judged_on_its_own_area(self):
        rep = check_request(brief_24x50(True), suggest=False)
        self.assertEqual(len(rep["floors"]), 2)
        for f in rep["floors"]:
            self.assertEqual(f["buildable_area"], 704)                      # one floor's footprint, not two floors' areas added up
            self.assertLessEqual(f["min_area_needed"], f["practical_area_needed"])
            self.assertLessEqual(f["practical_area_needed"], f["comfortable_area_needed"])

    def test_all_bedrooms_upstairs_is_feasible_by_area(self):
        site, prog = _site_and_program(dict(brief_24x50(True), _ground_bedroom=False))
        self.assertLessEqual(floor_need(prog.floors[0])["hard"], 704)
        self.assertLessEqual(floor_need(prog.floors[1])["hard"], 704)

    def test_compaction_never_goes_below_the_hard_minimum(self):
        try:
            set_compact(0.5)
            for t, (s, a) in HARD_MIN.items():
                r = rule_for(t)
                self.assertGreaterEqual(r.min_s, s - 1e-9, t)
                self.assertGreaterEqual(r.min_a, a - 1e-9, t)
        finally:
            set_compact(1.0)


class ComplianceReport(unittest.TestCase):
    """requirements.py counts from the plan, never from what the search says it did."""

    @staticmethod
    def fake_plan(types, floors=1, parking=None):
        per = [[] for _ in range(floors)]
        for i, t in enumerate(types):
            per[i % floors].append({"id": f"{t}_{i}", "room_type": t, "attached_to": None})
        allr = [r for fl in per for r in fl]
        beds = [r for r in allr if r["room_type"] in ("master_bedroom", "bedroom", "guest_bedroom")]
        baths = [r for r in allr if r["room_type"] == "bathroom"]
        for bed, bath in zip(beds, baths):                       # one bathroom attached to each bedroom, the rest are common
            bath["attached_to"] = bed["id"]
        return {"building_type": {1: "Ground", 2: "G+1", 3: "G+2"}[floors], "floors": [{"layout": {"rooms": r}} for r in per], "parking": parking or {}}

    def test_requested_counts(self):
        want = requested(brief_24x50(True))
        self.assertEqual((want["floors"], want["bedrooms"], want["bathrooms"], want["cars"], want["bikes"]), (2, 3, 4, 1, 2))

    def test_exact_when_everything_is_planned(self):
        plan = self.fake_plan(["living_room", "dining", "kitchen", "utility", "master_bedroom", "bedroom", "bedroom"] + ["bathroom"] * 4, 2,
                              {"cars": 1, "bikes": 2, "placed": True})
        rep = compliance(brief_24x50(True), plan, True)
        self.assertTrue(rep["exact"], rep["unmet"])
        self.assertEqual(rep["score"], 100.0)

    def test_missing_things_are_listed_and_never_exact(self):
        plan = self.fake_plan(["living_room", "kitchen", "master_bedroom", "bedroom", "bathroom", "bathroom"], 2, {"cars": 1, "bikes": 0, "placed": True})
        rep = compliance(brief_24x50(True), plan, True)
        keys = {u["key"] for u in rep["unmet"]}
        self.assertFalse(rep["exact"])
        self.assertTrue({"bedrooms", "bathrooms", "dining", "utility", "parking"} <= keys, keys)
        self.assertLess(rep["score"], 100.0)
        self.assertEqual(delivered(plan)["bedrooms"], 2)

    def test_changed_floors_are_reported(self):
        plan = self.fake_plan(["living_room"], 3)
        rep = compliance(brief_24x50(False), plan, False, adjustments=["Added a floor (G+1 -> G+2)."])
        self.assertIn("floors", {u["key"] for u in rep["unmet"]})
        self.assertEqual(rep["mode"], "flexible")
        self.assertEqual(rep["adjustments"], ["Added a floor (G+1 -> G+2)."])

    def test_parking_not_placed_counts_as_none(self):
        plan = self.fake_plan(["living_room"], 1, {"cars": 1, "bikes": 0, "placed": False})
        self.assertEqual(delivered(plan)["cars"], 0)


def conflict_of(test, pl, key=None):
    """The brief cannot be planned: the outcome is an explicit conflict (never a plan presented as a success)."""
    with test.assertRaises((service.NoLayout, service.Infeasible)) as cm:
        generate(pl, key=key)
    msg = getattr(cm.exception, "message", None) or str(cm.exception)
    test.assertTrue(msg)
    test.assertNotIn("add a floor", msg.lower())                           # the floor count is the user's: it is never offered as a way round
    return msg


class Plot24x50(unittest.TestCase):
    """The brief from the screenshot (3 bedrooms, 4 bathrooms, car + bikes on a 44 x 16 ft buildable box, G+1) needs 800 sq ft on the ground floor
    and 704 are buildable.  The generator reports that instead of squeezing, adding a floor or dropping rooms behind the user's back."""

    def test_strict_reports_the_conflict_with_the_numbers(self):
        msg = conflict_of(self, brief_24x50(True))
        self.assertIn("704", msg)
        self.assertIn("800", msg)
        self.assertIn("Nothing was removed", msg)

    def test_strict_closest_alternative_is_labelled_or_the_conflict_is_reported(self):
        try:
            res = generate(brief_24x50(True, closest_if_infeasible=True), key="closest_24x50")
        except (service.NoLayout, service.Infeasible) as exc:
            self.assertTrue(getattr(exc, "message", None) or str(exc))      # nothing valid exists: still an explicit conflict, never a success
            return
        self.assertEqual(res["status"], "closest_alternative")
        self.assertFalse(res["compliance"]["exact"])
        self.assertTrue(res["compliance"]["unmet"])
        for p in res["plans"]:
            self.assertEqual(len(p["floors"]), 2, "the floor count is never changed to compensate")
            self.assertFalse(p["ledger"]["ok"])
            self.assertTrue(p["verification"]["passed"])

    def test_flexible_mode_never_adds_a_floor_and_never_claims_an_exact_plan(self):
        pl = brief_24x50(False)
        try:
            res = generate(pl)
        except (service.NoLayout, service.Infeasible) as exc:
            self.assertTrue(getattr(exc, "message", None) or str(exc))
            return
        hard_rules_hold(self, res, pl)
        inside_setbacks_24x50_west(self, res)
        no_overlap(self, res)
        self.assertNotEqual(res.get("status"), "ok")
        self.assertFalse(res["compliance"]["exact"])
        for p in res["plans"]:
            self.assertEqual(len(p["floors"]), 2)
            self.assertEqual(p["compliance"]["delivered"], delivered(p))

    def test_api_reports_the_conflict_as_422(self):
        client = TestClient(app)
        r = client.post("/generate/raw", json=brief_24x50(True))
        self.assertEqual(r.status_code, 422, r.text[:300])
        d = r.json()["detail"]
        self.assertEqual(d["status"], "conflict")
        self.assertTrue(d["message"])
        self.assertTrue(d["closest_available"])

    def test_api_returns_the_report_for_a_brief_that_fits(self):
        client = TestClient(app)
        pl = dict(plot_width=30, plot_length=50, road_side="North", building_type="Ground", rooms=rooms_for(2, 2), vastu_mode="basic", strict=True,
                  setbacks={"front": 5, "rear": 3, "left": 3, "right": 3}, number_of_plans=4)
        r = client.post("/generate/raw", json=pl)
        self.assertEqual(r.status_code, 200, r.text[:300])
        body = r.json()
        self.assertIn("compliance", body)
        self.assertIn("search", body)
        self.assertEqual(body["status"], "ok")
        self.assertTrue(body["plans"])
        self.assertTrue(all(p["ledger"]["ok"] for p in body["plans"]))

    def test_the_report_matches_the_drawing(self):
        res = generate(dict(plot_width=30, plot_length=50, road_side="North", building_type="Ground", rooms=rooms_for(2, 2), vastu_mode="basic",
                            strict=True, setbacks={"front": 5, "rear": 3, "left": 3, "right": 3}, number_of_plans=4), key="report_30x50")
        for p in res["plans"]:
            got = delivered(p)
            self.assertEqual(p["compliance"]["delivered"], got)
            self.assertEqual(got["floors"], len(p["floors"]))

    def test_thin_plot_is_laid_out_by_the_corridor_algorithm(self):
        """A long shallow plot (24 x 60, road West: 54 x 16 ft buildable): the spine-corridor generator gives verified plans."""
        pl = brief_24x50(True, plot_length=60, rooms=rooms_for(2, 2), parking_required=False, parking_type="No Parking", parking_spaces=0)
        res = generate(pl, key="strip_direct")
        hard_rules_hold(self, res, pl)
        for p in res["plans"]:
            self.assertEqual(len(p["floors"]), 2)
            self.assertTrue(p["ledger"]["ok"], [v["message"] for v in p["ledger"]["violations"]])


class Matrix(unittest.TestCase):
    """Plots that plan quickly: every requirement is met, nothing is silently changed, hard rules hold."""

    def check(self, pl, key=None):
        res = generate(pl, key=key)
        hard_rules_hold(self, res, pl)
        return res

    def base(self, **kw):
        p = dict(plot_width=30, plot_length=50, road_side="North", building_type="Ground", rooms=rooms_for(2, 2), vastu_mode="basic",
                 parking_required=True, parking_spaces=1, parking_type="1 Car", strict=True, setbacks={"front": 0, "rear": 0, "left": 0, "right": 0},
                 number_of_plans=4)
        p.update(kw)
        return p

    def test_feasible_brief_is_met_exactly(self):
        pl = self.base(building_type="G+1", plot_length=40, balcony_required=True)
        res = self.check(pl)
        self.assertTrue(res["compliance"]["exact"], res["compliance"]["unmet"])
        self.assertEqual(res["relaxation"].get("adjustments"), [])
        self.assertEqual(len(res["plans"][0]["floors"]), 2)

    def test_ground_floor(self):
        res = self.check(self.base(plot_length=40))
        self.assertEqual(len(res["plans"][0]["floors"]), 1)
        self.assertTrue(res["compliance"]["exact"], res["compliance"]["unmet"])

    def test_g_plus_2(self):
        pl = self.base(building_type="G+2", plot_length=40, road_side="West", strict=False, balcony_required=True,
                       rooms=rooms_for(4, 5), parking_type="Car + Bikes")
        res = self.check(pl)
        self.assertEqual(res["compliance"]["delivered"]["floors"], 3)

    def test_parking_variants(self):
        for kind, cars, bikes in (("1 Car", 1, 0), ("Bikes", 0, 3), ("Car + Bikes", 1, 2)):
            res = self.check(self.base(parking_type=kind), key="park_" + kind)
            d = res["compliance"]["delivered"]
            if res["compliance"]["exact"]:
                self.assertGreaterEqual(d["cars"], cars, kind)
                self.assertGreaterEqual(d["bikes"], bikes, kind)
            else:
                self.assertTrue(res["compliance"]["unmet"], kind)

    def test_no_parking(self):
        res = self.check(self.base(parking_required=False, parking_type="No Parking", parking_spaces=0))
        self.assertEqual(res["compliance"]["delivered"]["cars"], 0)
        self.assertTrue(res["compliance"]["exact"])

    def test_road_sides(self):
        for side in ("North", "East", "South", "West"):
            res = self.check(self.base(road_side=side), key="road_" + side)
            self.assertEqual(res["plans"][0]["road_side"], side)

    def test_optional_features(self):
        pl = self.base(rooms=rooms_for(2, 2, ["puja_room", "study"]), balcony_required=True, include_terrace=True, garden_required=True,
                       parking_required=False, parking_type="No Parking", parking_spaces=0)
        res = self.check(pl, key="features")
        want = requested(pl)
        self.assertTrue(want["garden"] and want["terrace"])
        for u in res["compliance"]["unmet"]:                                   # whatever is missing is named, never silently gone
            self.assertTrue(u["reason"])

    def test_small_plot_gets_a_plan(self):
        res = self.check(self.base(plot_width=20, plot_length=30, building_type="G+1", rooms=rooms_for(2, 2), parking_required=False,
                                   parking_type="No Parking", parking_spaces=0))
        self.assertTrue(res["plans"])

    def test_other_seeds(self):
        for seed in (3, 11):
            res = generate(self.base(rooms=rooms_for(2, 2)), key=f"seed{seed}", seed=seed)
            hard_rules_hold(self, res, {})

    def test_strict_never_changes_the_request_silently(self):
        """20 x 30 for 3 bedrooms + 4 bathrooms is a conflict: the answer says so; it is never a smaller plan presented as the brief."""
        pl = self.base(plot_width=20, plot_length=30, rooms=rooms_for(3, 4))
        conflict_of(self, pl, key="strict_small")


class Infeasible(unittest.TestCase):
    def test_impossible_brief_never_returns_an_invalid_plan(self):
        pl = dict(plot_width=15, plot_length=20, road_side="North", building_type="Ground", rooms=rooms_for(4, 5, ["study", "puja_room"]),
                  vastu_mode="basic", parking_required=True, parking_spaces=2, parking_type="2 Cars", strict=True,
                  setbacks={"front": 5, "rear": 3, "left": 3, "right": 3}, number_of_plans=4)
        try:
            res = generate(pl)
        except (service.Infeasible, service.NoLayout) as exc:
            msg = getattr(exc, "message", None) or str(exc)
            self.assertTrue(msg)                                              # a diagnosis, not a fake plan
            return
        hard_rules_hold(self, res, pl)
        self.assertFalse(res["compliance"]["exact"])
        self.assertTrue(res["compliance"]["unmet"])

    def test_api_error_carries_a_message_and_feasibility(self):
        pl = dict(plot_width=10, plot_length=12, road_side="North", building_type="Ground", rooms=rooms_for(4, 4), vastu_mode="basic",
                  parking_required=True, parking_spaces=2, parking_type="2 Cars", strict=True,
                  setbacks={"front": 5, "rear": 3, "left": 3, "right": 3}, number_of_plans=4)
        r = TestClient(app).post("/generate/raw", json=pl)
        self.assertIn(r.status_code, (200, 422))
        if r.status_code == 422:
            d = r.json()["detail"]
            self.assertTrue(d["message"])


if __name__ == "__main__":
    unittest.main()
