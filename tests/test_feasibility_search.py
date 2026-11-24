"""Feasibility engine: valid briefs are planned, impossible ones are proven impossible, unlucky searches are not mistaken for impossibility.

Regression for the report "Your exact brief cannot be planned on this plot" on a 50 x 60 ft plot (road South, 60 ft frontage), G+1, 3 BHK, one car,
front / rear garden, upper-floor balcony, cross ventilation, closed puja.  The brief was valid; the strict search ran ONE seeded, clock-driven attempt
with every layout-quality rule on, then shrank the rooms, and finally blamed the parking whatever the real cause was.

A  the exact 50 x 60 brief gives valid plans (every returned candidate passes the geometric checks of J)
B  the parking is searched at several positions along the frontage; the bay is never reduced
C  bedrooms and bathrooms are spread over both floors without changing any count
D  a compact two-floor plot is planned
E  a genuinely impossible brief is proven impossible (named constraint), never "found", never blamed on parking when the numbers say otherwise;
   the closest alternative is labelled and never exact
F  only a preference blocks: needs approval -> proposed with a reason, applied only when approved, nothing else changes
G  road orientation: one consistent frontage / depth / setback picture on every side
H  the legible dimensions of PLAN - 1.pdf (see tests/fixtures/plan1_reference.json)
I  regressions: stairs, parking, room counts, upper floors, circulation
J  every returned candidate satisfies plot boundary, setbacks, room dimensions, parking geometry, floor and room counts
"""
import json
import unittest
from collections import Counter
from pathlib import Path

from backend.planner.architect import service
from backend.planner.architect.diagnostics import ADJUSTABLE, apply_adjustments, diagnose, propose_adjustments
from backend.planner.architect.feasibility import check_request
from backend.planner.architect.rules import CAR_BAY_L, CAR_BAY_W, set_aspect, set_compact, set_strict, rule_for, room_ok
from backend.planner.architect.spec import normalise_site

ROOT = Path(__file__).resolve().parents[1]
EPS = 0.06
BEDS = ("master_bedroom", "bedroom", "guest_bedroom")
_CACHE = {}


def a_brief(**kw):
    names = ["living_room", "dining", "kitchen", "utility", "master_bedroom", "bedroom", "bedroom", "bathroom", "bathroom", "bathroom", "puja_room"]
    p = dict(plot_width=50, plot_length=60, frontage_ft=60, road_side="South", setbacks={"front": 5, "rear": 3, "left": 3, "right": 3},
             rooms=[{"room_type": t} for t in names], building_type="G+1", number_of_plans=4, include_terrace=False, parking_required=True,
             parking_spaces=1, parking_type="1 Car", floor_height=10, stair_width=4, vastu_mode="basic", architectural_style="traditional_indian",
             climate="Auto", balcony_required=True, garden_required=True, common_toilet="attached", strict=True, ventilation="Cross ventilation",
             puja_style="closed")
    p.update(kw)
    return p


def small_brief(w=34, l=30, road="North", garden=False, **kw):
    """2 BHK, G+1, no parking (the garden strip alone decides whether it fits at 34 x 30)."""
    names = ["living_room", "dining", "kitchen", "master_bedroom", "bedroom", "bathroom", "bathroom"]
    return a_brief(plot_width=w, plot_length=l, frontage_ft=w, road_side=road, rooms=[{"room_type": t} for t in names], balcony_required=False,
                   parking_required=False, parking_spaces=0, parking_type="No Parking", garden_required=garden, ventilation="Balanced",
                   vastu_mode="no_preference", **kw)


def gen(key, payload, **kw):
    if key not in _CACHE:
        _CACHE[key] = service.generate(payload, **kw)
    return _CACHE[key]


def result_a():
    return gen("A", a_brief(), budget_s=6.0, seed=1, max_total_s=90.0)      # the budget and seed that failed before the fix


# ---- geometric checks shared by every test -----------------------------------------------------------------------------------------------
def overlap(a, b):
    return min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"]) > EPS and \
        min(a["y"] + a["length"], b["y"] + b["length"]) - max(a["y"], b["y"]) > EPS


def front_edge(rooms, road):
    if road == "South":
        return max(r["y"] + r["length"] for r in rooms)
    if road == "North":
        return min(r["y"] for r in rooms)
    if road == "East":
        return max(r["x"] + r["width"] for r in rooms)
    return min(r["x"] for r in rooms)


def touches_front(r, edge, road):
    got = {"South": r["y"] + r["length"], "North": r["y"], "East": r["x"] + r["width"], "West": r["x"]}[road]
    return abs(got - edge) < EPS


def check_plan(test, plan, payload, res):
    """Plot boundary, setbacks, room dimensions, parking geometry, floors, room counts, stair continuity, circulation -- all from the geometry."""
    p = normalise_site(payload)
    nf = {"Ground": 1, "G+1": 2, "G+2": 3, "Duplex": 2}[p["building_type"]]
    test.assertEqual(len(plan["floors"]), nf, "the floor count is exactly as asked")
    road = plan["road_side"]
    lay0 = plan["floors"][0]["layout"]
    up = lay0["usable_plot"]
    sb = p["setbacks"]
    test.assertAlmostEqual(up["area"], up["width"] * up["length"], places=1)
    test.assertGreaterEqual(up["x"], 0.0)
    plot = lay0["plot"]
    # setbacks: the usable rectangle is the plot minus the setbacks on the right sides
    test.assertAlmostEqual(plot["width"] * plot["length"], p["plot_width"] * p["plot_length"], places=1)
    ns = road in ("North", "South")
    fr, dp = (plot["width"], plot["length"]) if ns else (plot["length"], plot["width"])
    test.assertAlmostEqual(fr, p["plot_frontage"], places=1)
    test.assertAlmostEqual(dp, p["plot_depth"], places=1)
    test.assertAlmostEqual(up["area"], (fr - sb["left"] - sb["right"]) * (dp - sb["front"] - sb["rear"]), places=1)
    counts = Counter()
    stairs = []
    for fi, fl in enumerate(plan["floors"]):
        rooms = fl["layout"]["rooms"]
        for r in rooms:
            counts[r["room_type"]] += 1
            test.assertGreaterEqual(r["x"], up["x"] - EPS, f"{r['name']} inside the setbacks")
            test.assertGreaterEqual(r["y"], up["y"] - EPS)
            test.assertLessEqual(r["x"] + r["width"], up["x"] + up["width"] + EPS, f"{r['name']} inside the setbacks")
            test.assertLessEqual(r["y"] + r["length"], up["y"] + up["length"] + EPS)
            test.assertGreaterEqual(min(r["width"], r["length"]), 2.9, f"{r['name']} has a usable short side")
        for i, a in enumerate(rooms):
            for b in rooms[i + 1:]:
                test.assertFalse(overlap(a, b), f"floor {fi}: {a['name']} overlaps {b['name']}")
        st = [r for r in rooms if r["room_type"] == "staircase"]
        test.assertEqual(len(st), 1 if nf > 1 else len(st), "one stair per floor")
        stairs.append([(r["x"], r["y"], r["width"], r["length"]) for r in st])
    if nf > 1:
        test.assertTrue(all(s == stairs[0] for s in stairs), "the stair is in the same place on every floor")
    # parking geometry
    if p.get("parking_required") and p.get("parking_spaces"):
        pk = [r for r in lay0["rooms"] if r["room_type"] == "parking"]
        test.assertEqual(len(pk), 1)
        bays = plan["parking"]["bays"]
        test.assertEqual(len(bays), p["parking_spaces"])
        for b in bays:
            test.assertGreaterEqual(b["width"], CAR_BAY_W - EPS, "the bay is never narrower than 9 ft")
            test.assertGreaterEqual(b["length"], CAR_BAY_L - EPS, "the bay is never shorter than 15 ft")
        non_yard = [r for r in lay0["rooms"]]
        test.assertTrue(touches_front(pk[0], front_edge(non_yard, road), road), "the porch is on the road side of the building")
        for r in lay0["rooms"]:
            if r is not pk[0]:
                test.assertFalse(overlap(pk[0], r), f"the porch is clear of {r['name']}")
    else:
        test.assertFalse([r for r in lay0["rooms"] if r["room_type"] in ("parking", "bike_parking")])
    # the verifier, the ledger and the circulation report agree
    test.assertTrue(plan["verification"]["passed"], plan["verification"].get("errors"))
    test.assertTrue(plan["ledger"]["ok"], plan["ledger"])
    for fl, rep in zip(plan["floors"], plan["circulation"]["floors"]):
        test.assertFalse(rep["issues"], rep["issues"])
    return counts


def expected_counts(payload):
    c = Counter(r["room_type"] for r in payload["rooms"])
    return c


class A_ExactBrief(unittest.TestCase):
    def test_exact_50x60_brief_is_planned_with_valid_geometry(self):
        res = result_a()
        self.assertEqual(res["outcome"], "exact")
        self.assertTrue(res["exact"])
        self.assertEqual(res["deviations"], [])
        self.assertGreaterEqual(len(res["plans"]), 1)
        self.assertEqual(res["search"]["verdict"], "exact")
        log = res["search"]["attempt_log"]
        self.assertTrue(log and log[-1]["outcome"] == "layout found")
        for plan in res["plans"]:
            check_plan(self, plan, a_brief(), res)

    def test_search_does_not_depend_on_one_seed(self):
        """The brief that used to fail for seeds 1-3 at a 6 s budget is planned for several seeds (each attempt log shows the stages used)."""
        for seed in (2, 3):
            res = gen(f"A{seed}", a_brief(), budget_s=6.0, seed=seed, max_total_s=90.0)
            self.assertEqual(res["outcome"], "exact", f"seed {seed}")
            check_plan(self, res["plans"][0], a_brief(), res)


class B_ParkingPositions(unittest.TestCase):
    def test_parking_is_tried_at_several_positions_and_never_reduced(self):
        res = result_a()
        xs = sorted({round([r for r in p["floors"][0]["layout"]["rooms"] if r["room_type"] == "parking"][0]["x"], 1) for p in res["plans"]})
        self.assertGreaterEqual(len(xs), 2, f"the candidates differ in where along the frontage the porch sits: {xs}")
        for p in res["plans"]:
            pk = [r for r in p["floors"][0]["layout"]["rooms"] if r["room_type"] == "parking"][0]
            bay = p["parking"]["bays"][0]
            self.assertGreaterEqual(bay["width"], 9.0)
            self.assertGreaterEqual(bay["length"], 15.0)
            self.assertGreaterEqual(pk["width"], 9.0)
            # the entrance (living room) and the stair are not inside the porch
            for r in p["floors"][0]["layout"]["rooms"]:
                if r["room_type"] in ("living_room", "staircase"):
                    self.assertFalse(overlap(pk, r))

    def test_diagnostic_reports_the_bay_without_shrinking_it(self):
        d = diagnose(a_brief())
        self.assertEqual(d["parking"]["bay_ft"], [CAR_BAY_W, CAR_BAY_L])
        self.assertTrue(d["parking"]["fits_depth"] and d["parking"]["fits_frontage"])
        self.assertFalse(d["parking"]["reduced_to_pass"])


class C_FloorAllocation(unittest.TestCase):
    def test_bedrooms_and_bathrooms_are_spread_over_both_floors_with_unchanged_counts(self):
        res = result_a()
        for p in res["plans"]:
            per_floor = [Counter(r["room_type"] for r in fl["layout"]["rooms"]) for fl in p["floors"]]
            beds = [sum(c[t] for t in BEDS) for c in per_floor]
            self.assertEqual(sum(beds), 3, "3 BHK: three bedrooms in total")
            self.assertTrue(all(b >= 1 for b in beds), f"each floor has a bedroom: {beds}")
            baths = [c["bathroom"] for c in per_floor]
            self.assertEqual(sum(baths), 3)
            attached = sum(1 for fl in p["floors"] for r in fl["layout"]["rooms"] if r["room_type"] == "bathroom" and r.get("attached_to"))
            self.assertGreaterEqual(attached, 1, "attached bathrooms stay attached")
            self.assertEqual(len(p["floors"]), 2)

    def test_floor_split_variants_only_when_the_user_did_not_fix_the_split(self):
        p = normalise_site(a_brief())
        p["rooms"] = list(p["rooms"])
        self.assertTrue(service._alloc_alternatives_allowed(p))
        self.assertFalse(service._alloc_alternatives_allowed(dict(p, floor_rooms=[["living_room"], ["bedroom"]])))
        self.assertFalse(service._alloc_alternatives_allowed(dict(p, family_context={"elderly": 1})))


class D_CompactPlot(unittest.TestCase):
    def test_compact_two_floor_plot_is_planned(self):
        pl = small_brief(34, 30, "North", garden=False)
        res = gen("D", pl, budget_s=10.0, seed=7, max_total_s=60.0)
        self.assertEqual(res["outcome"], "exact")
        for plan in res["plans"]:
            c = check_plan(self, plan, pl, res)
            self.assertEqual(sum(c[t] for t in BEDS), 2)


class E_Infeasible(unittest.TestCase):
    def test_impossible_brief_is_proven_impossible_and_names_the_failing_constraint(self):
        pl = a_brief(plot_width=20, plot_length=30, frontage_ft=20, road_side="North", parking_spaces=2, parking_type="2 Cars")
        with self.assertRaises(service.NoLayout) as cm:
            service.generate(pl)
        ex = cm.exception
        self.assertEqual(ex.verdict, "infeasible")
        d = ex.diagnostic
        self.assertTrue(d["failed_mandatory"], "the failing mandatory constraint is named")
        self.assertEqual(d["outcome"], "infeasible", "no preference change fixes it")
        self.assertEqual(d["blocked_by_preferences"], [])
        self.assertTrue(any(c["code"] in ("FEASIBILITY", "AREA", "PARKING") for c in ex.conflicts))
        self.assertNotIn("competes with the rooms for the same frontage", ex.message, "the old unconditional parking blame is gone")

    def test_parking_is_blamed_only_when_the_numbers_say_so(self):
        # 14 ft of frontage cannot hold a 9 ft porch plus an entrance
        pl = a_brief(plot_width=20, plot_length=40, frontage_ft=20, road_side="North", setbacks={"front": 5, "rear": 3, "left": 4, "right": 4})
        d = diagnose(pl)
        self.assertTrue(any(f["constraint"] == "parking" for f in d["failed_mandatory"]))
        d2 = diagnose(a_brief())
        self.assertFalse(any(f["constraint"] == "parking" for f in d2["failed_mandatory"]), "50 x 60 is not a parking conflict")

    def test_failed_search_is_inconclusive_not_infeasible(self):
        from unittest import mock

        def once(adj, budget_s=14.0, seed=None):
            raise service.NoLayout({}, "nothing found")
        with mock.patch.object(service, "_generate_once", once):
            with self.assertRaises(service.NoLayout) as cm:
                service.generate(a_brief(plot_width=51), budget_s=1.0, seed=99)
        ex = cm.exception
        self.assertEqual(ex.verdict, "inconclusive")
        self.assertGreater(len(ex.attempts), 5)
        self.assertIn("within the search performed", ex.message)
        self.assertEqual(ex.diagnostic["outcome"], "inconclusive")
        self.assertTrue(any(c["code"] == "SEARCH_INCONCLUSIVE" for c in ex.conflicts))

    def test_closest_alternative_is_labelled_and_never_exact(self):
        from tests.test_parking import payload as pk_payload
        pl = pk_payload(20, 30, "North", bhk=1, strict=True)
        res = gen("E_closest", dict(pl, closest_if_infeasible=True))
        self.assertEqual(res["status"], "closest_alternative")
        self.assertEqual(res["outcome"], "closest_alternative")
        self.assertFalse(res["exact"])
        self.assertTrue(res["deviations"], "every deviation is listed")
        self.assertFalse(res["compliance"]["exact"])
        for p in res["plans"]:
            self.assertTrue(p["verification"]["passed"])
            self.assertFalse(p["ledger"]["ok"], "never labelled as the exact brief")
        self.assertIn("diagnostic", res)


class F_PreferenceNeedsApproval(unittest.TestCase):
    def test_garden_only_blocks_the_brief_and_is_changed_only_with_approval(self):
        pl = small_brief(34, 30, "North", garden=True)
        with self.assertRaises(service.NoLayout) as cm:
            service.generate(pl)
        d = cm.exception.diagnostic
        self.assertEqual(d["outcome"], "needs_approval")
        self.assertEqual(d["blocked_by_preferences"], ["garden_off"])
        self.assertIn("approval", cm.exception.message)
        # nothing was changed behind the user's back
        self.assertTrue(pl["garden_required"])
        props = propose_adjustments(pl, verify=True, verify_budget_s=10.0)
        self.assertEqual(props["status"], "preference_change_works")
        self.assertEqual(props["recommended"], ["garden_off"])
        garden = [x for x in props["proposals"] if x["id"] == "garden_off"][0]
        self.assertTrue(garden["verified"] and garden["reason"] and garden["from"] is True and garden["to"] is False)
        self.assertTrue(all(m["needs_explicit_decision"] for m in props["mandatory_decisions"]))
        # approved: exactly that change, nothing else
        res = service.generate(dict(pl, approved_adjustments=["garden_off"]), budget_s=10.0, max_total_s=60.0)
        self.assertEqual(res["outcome"], "mandatory_only")
        self.assertFalse(res["exact"])
        self.assertEqual([x["id"] for x in res["approved_adjustments"]], ["garden_off"])
        self.assertEqual([x["kind"] for x in res["deviations"]], ["approved_change"])
        self.assertEqual(len(res["plans"][0]["floors"]), 2)
        self.assertEqual(Counter(r["room_type"] for fl in res["plans"][0]["floors"] for r in fl["layout"]["rooms"] if r["room_type"] in BEDS), Counter({"master_bedroom": 1, "bedroom": 1}))
        for plan in res["plans"]:
            check_plan(self, plan, dict(pl, garden_required=False), res)

    def test_only_listed_preferences_can_be_approved_and_nothing_mandatory_changes(self):
        pl = small_brief(34, 30, "North", garden=True)
        q, applied = apply_adjustments(pl, ["garden_off", "drop_a_bedroom", "parking_off", "building_type", "balcony_off"])
        self.assertEqual([a["id"] for a in applied], ["garden_off"], "unknown ids and preferences that are not set are ignored")
        for k in ("rooms", "building_type", "parking_required", "plot_width", "plot_length", "setbacks"):
            self.assertEqual(q[k], pl[k], f"{k} is untouched")
        self.assertFalse(q["garden_required"])
        self.assertTrue(set(ADJUSTABLE) .isdisjoint({"rooms", "building_type", "parking_required", "setbacks"}))

    def test_diagnostic_separates_footprint_from_stacked_floor_area(self):
        d = diagnose(a_brief())
        a = d["area_summary"]
        self.assertEqual(a["ground_floor_footprint_capacity_sqft"], d["geometry"]["ground_footprint_capacity_sqft"])
        self.assertEqual(a["total_capacity_all_floors_sqft"], 2 * a["ground_floor_footprint_capacity_sqft"])
        self.assertEqual(set(a["required_by_floor_sqft"]), {"Ground Floor", "First Floor"})


class G_RoadOrientation(unittest.TestCase):
    def test_one_consistent_geometry_on_every_road_side(self):
        for road in ("North", "South", "East", "West"):
            d = diagnose(a_brief(road_side=road))
            g = d["geometry"]
            self.assertEqual((g["frontage_ft"], g["depth_ft"]), (60.0, 50.0), road)
            self.assertEqual((g["usable_frontage_ft"], g["usable_depth_ft"], g["usable_area_sqft"]), (54.0, 42.0, 2268), road)
            self.assertEqual(g["buildable_depth_ft"], 34.0)
            self.assertEqual(d["verdict"], "feasible")

    def test_the_other_frontage_choice_swaps_nothing_silently(self):
        d = diagnose(a_brief(frontage_ft=50, road_side="North"))
        g = d["geometry"]
        self.assertEqual((g["frontage_ft"], g["depth_ft"]), (50.0, 60.0))
        self.assertEqual(g["usable_frontage_ft"], 44.0)
        self.assertEqual(g["usable_depth_ft"], 52.0)

    def test_wrong_frontage_is_flagged_not_guessed(self):
        d = diagnose(a_brief(frontage_ft=55))
        self.assertEqual(d["verdict"], "invalid")
        self.assertIn("must be one of the two plot dimensions", d["error"])

    def test_plans_on_two_different_road_sides_are_valid(self):
        for road in ("East", "North"):
            pl = small_brief(34, 30, road, garden=False)
            res = gen(f"G_{road}", pl, budget_s=10.0, seed=7, max_total_s=60.0)
            self.assertEqual(res["outcome"], "exact", road)
            self.assertEqual(res["plans"][0]["road_side"], road)
            check_plan(self, res["plans"][0], pl, res)


class H_Plan1Reference(unittest.TestCase):
    """Only what is legible on PLAN - 1.pdf: the room sizes and the floor split.  The plot size is not on the drawing and is not assumed."""
    ref = json.loads((ROOT / "tests" / "fixtures" / "plan1_reference.json").read_text())

    def test_fixture_marks_unknowns_as_unknown(self):
        self.assertIsNone(self.ref["plot"]["width_ft"])
        self.assertIn("NOT assumed", self.ref["plot"]["note"])
        for fl in ("ground", "first"):
            for r in self.ref[fl]["rooms"]:
                self.assertEqual(r["w"] is None, r["d"] is None, r)

    def test_printed_areas_are_consistent_with_the_legible_rooms(self):
        g = sum(r["w"] * r["d"] for r in self.ref["ground"]["rooms"] if r["w"])
        f = sum(r["w"] * r["d"] for r in self.ref["first"]["rooms"] if r["w"])
        self.assertLessEqual(g, self.ref["stated_floor_area_sqft"]["ground"])
        self.assertLessEqual(f, self.ref["stated_floor_area_sqft"]["first"])

    def test_the_real_habitable_rooms_are_accepted_by_the_engines_relaxed_shape_rules(self):
        set_strict(True)
        set_aspect(1.6)
        try:
            for t, w, d in (("bedroom", 10.0, 14.0), ("bedroom", 11.25, 10.0), ("bedroom", 13.25, 12.0), ("living_room", 13.25, 15.0), ("kitchen", 11.25, 15.5)):
                self.assertTrue(room_ok(rule_for(t), w, d), f"{t} {w} x {d} (a built room) must not be rejected")
        finally:
            set_strict(True)
            set_compact(1.0)

    def test_the_reference_programme_is_accepted_for_planning(self):
        """G+1, 1 bedroom down and 3 up, one car, balcony, as in the drawing: the plan is not rejected by the analysis on plots large enough for
        its 755.5 / 923.5 sq ft floors (the plots below are test assumptions, NOT read from the drawing)."""
        ground = ["living_room", "dining", "kitchen", "utility", "bedroom", "bathroom"]
        first = ["master_bedroom", "bedroom", "bedroom", "family_lounge", "bathroom", "bathroom"]
        for w, l in ((30, 50), (35, 45), (40, 40)):
            pl = a_brief(plot_width=w, plot_length=l, frontage_ft=w, road_side="North", floor_rooms=[ground, first], garden_required=False,
                         puja_style="closed", ventilation="Balanced", vastu_mode="no_preference")
            rep = check_request(pl, suggest=False)
            self.assertNotEqual(rep["status"], "infeasible", (w, l, rep.get("errors")))
            self.assertEqual(len(rep["floors"]), 2)


class I_Regressions(unittest.TestCase):
    def test_stairs_parking_counts_and_upper_floor_on_the_fixed_case(self):
        res = result_a()
        pl = a_brief()
        for plan in res["plans"]:
            c = check_plan(self, plan, pl, res)
            for t in ("living_room", "dining", "kitchen", "utility", "puja_room", "parking"):
                self.assertEqual(c[t], 1, t)
            self.assertEqual(c["bathroom"], 3)
            self.assertEqual(sum(c[t] for t in BEDS), 3)
            self.assertEqual(c["staircase"], 2, "one stair per floor")
            self.assertEqual(c["balcony"], 1)
            upper = plan["floors"][1]["layout"]["rooms"]
            self.assertTrue(any(r["room_type"] in BEDS for r in upper))
            self.assertFalse([r for r in upper if r["room_type"] in ("parking", "living_room")], "the upper floor holds no ground-floor rooms")

    def test_status_and_conflict_payloads_keep_their_shape(self):
        res = result_a()
        for k in ("status", "total_plans", "plans", "warnings", "compliance", "relaxation", "search", "outcome", "deviations"):
            self.assertIn(k, res)
        self.assertEqual(res["status"], "ok")

    def test_infeasible_http_payload_carries_verdict_and_diagnostic(self):
        from fastapi.testclient import TestClient
        from backend.main import app
        r = TestClient(app).post("/generate/raw", json=a_brief(plot_width=20, plot_length=30, frontage_ft=20, road_side="North", parking_spaces=2, parking_type="2 Cars"))
        self.assertEqual(r.status_code, 422)
        det = r.json()["detail"]
        self.assertEqual(det["status"], "conflict")
        self.assertEqual(det["verdict"], "infeasible")
        self.assertEqual(det["outcome"], "infeasible")
        self.assertTrue(det["diagnostic"]["failed_mandatory"])

    def test_diagnose_and_adjustments_endpoints(self):
        from fastapi.testclient import TestClient
        from backend.main import app
        c = TestClient(app)
        d = c.post("/diagnose", json=a_brief()).json()
        self.assertEqual(d["verdict"], "feasible")
        self.assertEqual(d["geometry"]["usable_area_sqft"], 2268)
        r = c.post("/adjustments", json=dict(small_brief(34, 30, "North", garden=True), verify=False))
        self.assertEqual(r.status_code, 200)
        self.assertEqual([p["id"] for p in r.json()["proposals"]], ["garden_off"])


class J_EveryCandidate(unittest.TestCase):
    def test_every_candidate_of_the_fixed_case_passes_the_geometric_checks(self):
        res = result_a()
        self.assertEqual(len(res["plans"]), res["total_plans"])
        self.assertGreaterEqual(len(res["plans"]), 2)
        for plan in res["plans"]:
            check_plan(self, plan, a_brief(), res)

    def test_every_candidate_on_a_compact_plot_passes_too(self):
        pl = small_brief(34, 30, "North", garden=False)
        res = gen("D", pl, budget_s=10.0, seed=7, max_total_s=60.0)
        for plan in res["plans"]:
            check_plan(self, plan, pl, res)


if __name__ == "__main__":
    unittest.main()
