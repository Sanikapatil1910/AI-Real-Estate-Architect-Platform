"""Car parking in the generator: when it is asked for it is planned, kept and shown; when it is not asked for there is none.

Covers the whole backend chain (brief -> engine -> adapter -> verifier -> 2D svg) on real generated plans:

* parking not selected: no bay anywhere, nothing reserved;
* one car selected: exactly one usable bay (>= 9 x 15 ft), inside a ground-floor porch that opens onto the road, clear of every
  other room, stair and wall, on every road side, small and large plots, one and two floors;
* the verifier rejects plans that lose / shrink / misplace the parking (so it cannot be dropped silently after optimisation);
* strict mode never removes parking; adjust mode tries every parking-keeping layout first and says so loudly when it finally has to
  leave it out;
* the 2D svg draws the bay.

The browser side (2D bay in the React plan, 3D car position) is in tests/test_parking_render.py."""
import copy
import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from backend.planner.architect import service
from backend.planner.architect.rules import CAR_BAY_L, CAR_BAY_W, BAY_CLEARANCE_FT, VEHICLE_FT, set_compact, set_strict
from backend.planner.architect.verify import verify_plan
from backend.renderer.floorplan_svg import render_floor_plan

ROOT = Path(__file__).resolve().parents[1]
_CACHE = {}


def brief(bhk=2):
    names = ["living_room", "dining", "kitchen", "utility", "master_bedroom"] + ["bedroom"] * (bhk - 1) + ["bathroom"] * bhk
    return [{"room_type": t} for t in names]


def payload(w, l, side="North", bt="Ground", bhk=2, cars=1, strict=False):
    park = cars > 0
    return dict(plot_width=w, plot_length=l, road_side=side, building_type=bt, rooms=brief(bhk), vastu_mode="basic",
                balcony_required=bt != "Ground", parking_required=park, parking_spaces=cars,
                parking_type=("No Parking" if not park else ("2 Cars" if cars == 2 else "1 Car")), strict=strict,
                number_of_plans=4, include_terrace=True, setbacks={"front": 0, "rear": 0, "left": 0, "right": 0})


def gen(*a, **k):
    key = json.dumps([a, k], sort_keys=True)
    if key not in _CACHE:
        p = payload(*a, **k)
        _CACHE[key] = (p, service.generate(p))
    return _CACHE[key]


def parking_rooms(plan, floor=0):
    return [r for r in plan["floors"][floor]["layout"]["rooms"] if r["room_type"] in ("parking", "bike_parking")]


def inside(inner, outer, tol=0.06):
    return (inner["x"] >= outer["x"] - tol and inner["y"] >= outer["y"] - tol
            and inner["x"] + inner["width"] <= outer["x"] + outer["width"] + tol
            and inner["y"] + inner["length"] <= outer["y"] + outer["length"] + tol)


def overlap(a, b, tol=0.01):
    return (a["x"] < b["x"] + b["width"] - tol and b["x"] < a["x"] + a["width"] - tol
            and a["y"] < b["y"] + b["length"] - tol and b["y"] < a["y"] + a["length"] - tol)


class ParkingGeometry(unittest.TestCase):
    """One car: exactly one usable bay, in the right place, on every kind of plot."""

    def check_one_car(self, p, res, road):
        self.assertGreaterEqual(len(res["plans"]), 1)
        self.assertNotIn(service.PARKING_DROPPED_NOTE, " ".join(res.get("warnings", [])), "parking must not have been dropped")
        self.assertTrue(res["parking"]["required"])
        for plan in res["plans"]:
            self.assertTrue(plan["verification"]["passed"], plan["verification"]["errors"])     # survived optimisation + validation
            pk = plan["parking"]
            self.assertEqual(pk["cars"], 1)
            self.assertTrue(pk["placed"])
            self.assertEqual(len(pk["bays"]), 1, "exactly one bay for one car")
            bay = pk["bays"][0]
            self.assertGreaterEqual(min(bay["width"], bay["length"]), CAR_BAY_W - 0.06)
            self.assertGreaterEqual(max(bay["width"], bay["length"]), CAR_BAY_L - 0.06)
            ground = plan["floors"][0]["layout"]["rooms"]
            porch = [r for r in ground if r["room_type"] == "parking"]
            self.assertEqual(len(porch), 1)
            porch = porch[0]
            self.assertTrue(inside(bay, porch), "the bay lies inside the porch")
            for o in ground:                                    # no room, stair or wall of another room in the bay
                if o is not porch:
                    self.assertFalse(overlap(bay, o), f"bay overlaps {o['room_type']}")
            rect = plan["terrace"]
            edge = {"North": porch["y"] - rect["y"], "South": rect["y"] + rect["length"] - (porch["y"] + porch["length"]),
                    "West": porch["x"] - rect["x"], "East": rect["x"] + rect["width"] - (porch["x"] + porch["width"])}[road]
            self.assertAlmostEqual(edge, 0.0, delta=0.06, msg="the porch opens onto the road")
            for fl in plan["floors"][1:]:                       # parking is a ground-floor thing
                self.assertEqual(parking_rooms({"floors": [fl]}), [])
            reg = plan["floors"][0]["layout"]["usable_plot"]["reserved_regions"]
            self.assertEqual(len(reg), 1)
            self.assertEqual(reg[0]["bays"], pk["bays"], "the reserved region carries the same bay (2D and 3D read it)")

    def test_parking_not_selected_adds_no_bay(self):
        p, res = gen(30, 40, "North", cars=0)
        self.assertFalse(res["parking"]["required"])
        for plan in res["plans"]:
            self.assertEqual(parking_rooms(plan), [])
            self.assertEqual(plan["parking"].get("bays", []), [])
            self.assertEqual(plan["floors"][0]["layout"]["usable_plot"].get("reserved_regions", []), [])
            self.assertTrue(plan["verification"]["passed"])
            svg = render_floor_plan(plan["floors"][0]["layout"], plan["floors"][0]["layout"]["plot"],
                                    plan["floors"][0]["layout"]["usable_plot"], "North")
            self.assertNotIn("data-parking", svg)

    def test_one_car_on_a_small_plot(self):
        p, res = gen(25, 40, "South")
        self.check_one_car(p, res, "South")

    def test_one_car_on_a_medium_plot(self):
        p, res = gen(30, 40, "North")
        self.check_one_car(p, res, "North")

    def test_one_car_on_a_large_plot(self):
        p, res = gen(40, 60, "North", bhk=3)
        self.check_one_car(p, res, "North")

    def test_one_car_with_the_road_on_the_east_and_the_west(self):
        for side in ("East", "West"):
            p, res = gen(50, 30, side)
            self.check_one_car(p, res, side)

    def test_one_car_on_two_floors_keeps_the_stair_clear_of_the_bay(self):
        p, res = gen(40, 60, "North", bt="G+1", bhk=3)
        self.check_one_car(p, res, "North")
        for plan in res["plans"]:
            self.assertEqual(len(plan["floors"]), 2)
            stairs = [[r for r in fl["layout"]["rooms"] if r["room_type"] == "staircase"] for fl in plan["floors"]]
            self.assertTrue(all(stairs), "a stair on every floor")
            bay = plan["parking"]["bays"][0]
            self.assertFalse(overlap(bay, stairs[0][0]), "the stair is outside the bay")
            a, b = stairs[0][0], stairs[1][0]                    # stacked stair: same place on both floors
            self.assertEqual((a["x"], a["y"], a["width"], a["length"]), (b["x"], b["y"], b["width"], b["length"]))

    def test_vehicle_size_and_clearance_are_configurable_constants(self):
        w, l = VEHICLE_FT["car"]
        self.assertAlmostEqual(CAR_BAY_W, w + 2 * BAY_CLEARANCE_FT["side"])
        self.assertAlmostEqual(CAR_BAY_L, l + BAY_CLEARANCE_FT["end"])


class ParkingIsVerified(unittest.TestCase):
    """The verifier is the gate every plan passes: parking that is lost, shrunk, moved or invented must fail it."""

    @classmethod
    def setUpClass(cls):
        cls.p, cls.res = gen(30, 40, "North")
        cls.plan = cls.res["plans"][0]

    def mutated(self):
        return copy.deepcopy(self.plan)

    def test_the_real_plan_passes(self):
        self.assertTrue(verify_plan(self.mutated(), self.p)["passed"])

    def test_missing_parking_is_an_error(self):
        pl = self.mutated()
        lay = pl["floors"][0]["layout"]
        porch = next(r for r in lay["rooms"] if r["room_type"] == "parking")
        porch["room_type"] = "utility"                                   # the porch is no longer a car porch
        r = verify_plan(pl, self.p)
        self.assertFalse(r["passed"])
        self.assertTrue(any("car parking" in e or "car(s) requested" in e for e in r["errors"]), r["errors"])

    def test_parking_that_was_not_requested_is_an_error(self):
        q = dict(self.p, parking_required=False, parking_spaces=0, parking_type="No Parking")
        r = verify_plan(self.mutated(), q)
        self.assertFalse(r["passed"])
        self.assertTrue(any("not requested" in e for e in r["errors"]), r["errors"])

    def test_a_too_small_porch_is_an_error(self):
        pl = self.mutated()
        porch = next(r for r in pl["floors"][0]["layout"]["rooms"] if r["room_type"] == "parking")
        porch["width"] = 6.0
        porch["x2"] = porch["x"] + 6.0
        r = verify_plan(pl, self.p)
        self.assertFalse(r["passed"])
        self.assertTrue(any("too small" in e for e in r["errors"]), r["errors"])

    def test_a_porch_that_does_not_reach_the_road_is_an_error(self):
        q = self.mutated()
        q["road_side"] = "South"                                         # the same plan, but the road is on the other side
        r = verify_plan(q, self.p)
        self.assertFalse(r["passed"])
        self.assertTrue(any("road" in e for e in r["errors"]), r["errors"])

    def test_a_bay_overlapping_a_room_is_an_error(self):
        pl = self.mutated()
        lay = pl["floors"][0]["layout"]
        porch = next(r for r in lay["rooms"] if r["room_type"] == "parking")
        other = next(r for r in lay["rooms"] if r is not porch and r["room_type"] != "parking")
        pl["parking"]["bays"][0].update(x=other["x"], y=other["y"])
        r = verify_plan(pl, self.p)
        self.assertFalse(r["passed"])
        self.assertTrue(any("bay" in e for e in r["errors"]), r["errors"])

    def test_a_missing_bay_is_an_error(self):
        pl = self.mutated()
        pl["parking"]["bays"] = []
        r = verify_plan(pl, self.p)
        self.assertFalse(r["passed"])
        self.assertTrue(any("bay" in e for e in r["errors"]), r["errors"])


class ParkingIsNeverDroppedSilently(unittest.TestCase):
    """The fallback ladder keeps the parking at every step; it is left out only as a last resort and then it is said so."""

    def tearDown(self):
        # these tests call the engine's inner steps directly, which switch process-wide rule flags that generate() normally restores
        set_strict(True)
        set_compact(1.0)

    def test_ladder_tries_every_parking_keeping_level_before_any_parking_free_level(self):
        p = payload(30, 40, "North", bt="G+1", bhk=3)
        flags = [adj.get("parking_required") for _, adj, _, _ in service._ladder(p)]
        self.assertTrue(flags[0])
        first_free = flags.index(False)
        self.assertGreater(first_free, 3, "several parking-keeping steps come first")
        self.assertTrue(all(flags[:first_free]) and not any(flags[first_free:]))

    def test_every_parking_free_level_carries_the_explanation(self):
        p = payload(30, 40, "North", bt="G+1", bhk=3)
        for _, adj, notes, _ in service._ladder(p):
            if adj.get("parking_required"):
                self.assertNotIn(service.PARKING_DROPPED_NOTE, notes)
            else:
                self.assertEqual(notes[0], service.PARKING_DROPPED_NOTE)
                self.assertIn("could not be fitted", notes[0])

    def test_keep_parking_ladder_has_no_parking_free_level(self):
        p = payload(30, 40, "North", bt="G+1", bhk=3)
        levels = list(service._ladder(p, keep_parking=True))
        self.assertGreater(len(levels), 3)
        self.assertTrue(all(adj.get("parking_required") for _, adj, _, _ in levels))

    def test_no_parking_brief_has_no_parking_in_any_level(self):
        p = payload(30, 40, "North", cars=0)
        self.assertFalse(any(adj.get("parking_required") for _, adj, _, _ in service._ladder(p)))

    def test_adjust_mode_last_resort_says_so_in_the_warnings_and_the_report(self):
        seen = []

        def once(adj, budget_s=14.0, seed=None):
            seen.append(bool(adj.get("parking_required")))
            if adj.get("parking_required"):
                raise service.NoLayout({}, "nothing fits")
            return {"search": {}, "warnings": [], "plans": []}

        p = payload(30, 40, "North")
        with mock.patch.object(service, "_generate_once", once):
            res = service._generate_relaxing(p, 5.0, 7, 600.0)
        self.assertTrue(seen[0] and seen.index(False) > 2, "parking-keeping steps were tried first")
        rel = res["relaxation"]
        self.assertFalse(rel["exact"])
        self.assertIn(service.PARKING_DROPPED_NOTE, rel["adjustments"])
        self.assertTrue(rel["requested"]["parking_required"])
        self.assertFalse(rel["delivered"]["parking_required"])
        self.assertTrue(any("car parking could not be fitted" in w for w in res["warnings"]))

    def test_strict_mode_never_removes_the_parking(self):
        seen = []

        def once(adj, budget_s=14.0, seed=None):
            seen.append(bool(adj.get("parking_required")))
            raise service.NoLayout({}, "nothing fits")

        p = payload(30, 40, "North", strict=True)
        with mock.patch.object(service, "_generate_once", once):
            with self.assertRaises(service.NoLayout) as cm:
                service._generate_strict(p, 4.0, 7)
        self.assertTrue(len(seen) > 5 and all(seen), "no step of the strict flow tried a brief without the parking, and it searched more than once")
        self.assertEqual(cm.exception.verdict, "inconclusive", "a failed search is not a proof of impossibility")
        self.assertIn("within the search performed", cm.exception.message)
        self.assertIn("Nothing was changed", cm.exception.message)

    def test_strict_mode_on_a_plot_too_small_reports_the_conflict_and_never_claims_success(self):
        """Strict mode: no plan is returned as a success; the conflict names the parking.  On request the closest valid alternative comes back,
        labelled as such, with the parking listed as not provided (counted from the plan)."""
        p = payload(20, 30, "North", bhk=1, strict=True)
        with self.assertRaises((service.NoLayout, service.Infeasible)) as cm:
            service.generate(p)
        self.assertIn("parking", (getattr(cm.exception, "message", None) or str(cm.exception)).lower())
        res = service.generate(dict(p, closest_if_infeasible=True))
        self.assertEqual(res["status"], "closest_alternative")
        rep = res["compliance"]
        self.assertFalse(rep["exact"])
        self.assertIn("parking", {u["key"] for u in rep["unmet"]})
        self.assertEqual(rep["delivered"]["cars"], 0)
        for plan in res["plans"]:
            self.assertTrue(plan["verification"]["passed"])
            self.assertFalse(plan["ledger"]["ok"], "the closest alternative is never an exact match")


class ParkingIn2D(unittest.TestCase):
    """The backend svg draws the same bay the plan declares (the React plan is checked in a browser in test_parking_render.py)."""

    def test_svg_has_the_bay_inside_the_porch(self):
        for name in ("pk_south", "pk_east", "pk_g1"):
            plan = json.loads((ROOT / "frontend-react" / "dev" / "fixtures" / f"{name}.json").read_text())
            lay = plan["floors"][0]["layout"]
            svg = render_floor_plan(lay, lay["plot"], lay["usable_plot"], lay["road_side"])
            self.assertEqual(svg.count("data-parking-bay="), 1, name)
            self.assertIn("parking-pattern", svg)
            self.assertIn("data-parking=", svg)
            bay = lay["usable_plot"]["reserved_regions"][0]["bays"][0]
            self.assertEqual(bay, plan["parking"]["bays"][0], name)

    def test_the_stored_fixtures_are_the_current_generator_output_shape(self):
        for name in ("pk_south", "pk_east", "pk_g1"):
            plan = json.loads((ROOT / "frontend-react" / "dev" / "fixtures" / f"{name}.json").read_text())
            self.assertTrue(plan["parking"]["placed"])
            self.assertTrue(plan["verification"]["passed"], name)


if __name__ == "__main__":
    unittest.main()
