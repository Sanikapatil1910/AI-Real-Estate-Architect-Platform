"""Strict requirement compliance of the generator (tests A-L of the compliance brief, backend side).

Every plan that is returned must carry the brief exactly: the floor count (G+1 = 2 floors, G+2 = 3), every requested room count (in total and, when
given, per floor), no room, terrace, balcony or parking that was not asked for, bathrooms clearly smaller than bedrooms, a usable kitchen, a chajja
over every window, and the frontage the user selected.  A brief that cannot be planned exactly is reported as a conflict -- never as a success.

The 3D / 2D side (kitchen fittings, chajja meshes, roof areas) is in ``test_strict_render.py``.
"""
import re
import unittest
from pathlib import Path

from backend.planner.architect import service
from backend.planner.architect.facade import chajja_problems
from backend.planner.architect.rules import BATH_MAX_SHARE_OF_PARENT, set_compact, set_strict
from backend.planner.architect.spec import build_spec, ledger, violations

ROOT = Path(__file__).resolve().parents[1]
_CACHE = {}
FLOORS = {"Ground": 1, "G+1": 2, "G+2": 3}
BEDS = ("master_bedroom", "bedroom", "guest_bedroom")


def rooms_for(beds, baths, extra=()):
    names = ["living_room", "dining", "kitchen", "master_bedroom"] + ["bedroom"] * (beds - 1) + ["bathroom"] * baths + list(extra)
    return [{"room_type": t} for t in names]


def brief(**kw):
    p = dict(vastu_mode="no_preference", parking_required=False, parking_spaces=0, parking_type="No Parking", strict=True, number_of_plans=4,
             include_terrace=False, setbacks={"front": 5, "rear": 3, "left": 3, "right": 3})
    p.update(kw)
    return p


def generate(payload, budget_s=10.0):
    k = repr(sorted((a, repr(b)) for a, b in payload.items()))
    if k not in _CACHE:
        set_strict(True)
        set_compact(1.0)
        try:
            _CACHE[k] = service.generate(dict(payload), budget_s=budget_s)
        except service.NoLayout as exc:
            _CACHE[k] = exc
        set_strict(True)
        set_compact(1.0)
    return _CACHE[k]


def counts(plan, floor=None):
    out = {}
    for i, fl in enumerate(plan["floors"]):
        if floor is not None and i != floor:
            continue
        for r in fl["layout"]["rooms"]:
            out[r["room_type"]] = out.get(r["room_type"], 0) + 1
    return out


def area(r):
    return r["width"] * r["length"]


class Strict(unittest.TestCase):
    def exact(self, payload, floors=None):
        """Plans came back for the exact brief and every one of them passes the whole ledger."""
        res = generate(payload)
        self.assertNotIsInstance(res, Exception, str(res))
        self.assertTrue(res["plans"], "a plan must come back")
        self.assertEqual(res.get("status", "ok"), "ok")
        want = floors or FLOORS[payload["building_type"]]
        spec = build_spec(payload)
        for p in res["plans"]:
            self.assertEqual(len(p["floors"]), want, "floor count is a hard constraint")
            led = p["ledger"]
            self.assertTrue(led["ok"], [v["message"] for v in led["violations"]])
            self.assertEqual(led["fingerprint"], spec.fingerprint(), "the requirement spec must not change during generation")
            self.assertTrue(led["floors"]["met"])
            self.assertTrue(all(t["met"] for t in led["totals"]), led["totals"])
            self.assertTrue(p["verification"]["passed"], p["verification"]["errors"][:3])
            self.assertEqual(violations(spec, p), [])
            self.assertEqual(chajja_problems(p), [])
            for fl in p["floors"]:                                   # nothing the user did not ask for
                for r in fl["layout"]["rooms"]:
                    if not payload.get("include_terrace"):
                        self.assertNotIn(r["room_type"], ("open_terrace", "balcony"), f"unrequested {r['room_type']}")
            for row in led["rooms"]:
                for k in ("id", "type", "floor", "width", "length", "area", "connections", "geometry_valid", "required_count", "actual_count",
                          "satisfies_requirement"):
                    self.assertIn(k, row)
                self.assertTrue(row["satisfies_requirement"], row)
        return res

    # A ----------------------------------------------------------------------------------------------------------------------------
    def test_A_50x60_frontage_50_g1_four_bedrooms(self):
        pl = brief(plot_width=50, plot_length=60, frontage_ft=50, road_side="South", building_type="G+1", rooms=rooms_for(4, 4))
        res = self.exact(pl)
        for p in res["plans"]:
            c = counts(p)
            self.assertEqual(c.get("master_bedroom", 0) + c.get("bedroom", 0), 4)
            self.assertEqual(c.get("bathroom", 0), 4)
            self.assertEqual(p["site"]["frontage"], 50)
            self.assertEqual(p["site"]["depth"], 60)
            self.assertEqual(len(p["floors"]), 2)

    # B ----------------------------------------------------------------------------------------------------------------------------
    def test_B_frontage_60_is_not_swapped_with_depth(self):
        pl = brief(plot_width=50, plot_length=60, frontage_ft=60, road_side="East", building_type="G+1", rooms=rooms_for(4, 4))
        res = self.exact(pl)
        for p in res["plans"]:
            self.assertEqual(p["site"]["frontage"], 60)
            self.assertEqual(p["site"]["depth"], 50)
            self.assertTrue(p["site"]["frontage_selected"])
            self.assertEqual(p["road_side"], "East")
        a = generate(brief(plot_width=50, plot_length=60, frontage_ft=50, road_side="South", building_type="G+1", rooms=rooms_for(4, 4)))
        self.assertNotEqual((a["plans"][0]["site"]["frontage"], a["plans"][0]["site"]["depth"]),
                            (res["plans"][0]["site"]["frontage"], res["plans"][0]["site"]["depth"]))

    # C ----------------------------------------------------------------------------------------------------------------------------
    def test_C_one_living_room_ground_floor_only(self):
        pl = brief(plot_width=40, plot_length=60, road_side="North", building_type="G+1", rooms=rooms_for(4, 3))
        for p in self.exact(pl)["plans"]:
            self.assertEqual(counts(p, 0).get("living_room", 0), 1)
            self.assertEqual(counts(p, 1).get("living_room", 0), 0)
            self.assertEqual(counts(p).get("living_room", 0), 1)
            self.assertEqual(counts(p, 1).get("kitchen", 0) + counts(p, 1).get("dining", 0), 0, "no duplicated public rooms upstairs")

    # D ----------------------------------------------------------------------------------------------------------------------------
    def test_D_g2_per_floor_counts(self):
        per = [["living_room", "dining", "kitchen", "bedroom", "bathroom"],
               ["master_bedroom", "bedroom", "bathroom", "bathroom"],
               ["bedroom", "bedroom", "bathroom", "bathroom"]]
        pl = brief(plot_width=40, plot_length=60, road_side="East", building_type="G+2", floor_rooms=per,
                   rooms=[{"room_type": t} for lst in per for t in lst])
        for p in self.exact(pl)["plans"]:
            self.assertEqual(len(p["floors"]), 3)
            for i, lst in enumerate(per):
                got = counts(p, i)
                for t in set(lst) | {"living_room", "dining", "kitchen", "master_bedroom", "bedroom", "bathroom"}:
                    self.assertEqual(got.get(t, 0), lst.count(t), f"floor {i} {t}")
            self.assertTrue(all(f["met"] for f in p["ledger"]["per_floor"]))

    # E ----------------------------------------------------------------------------------------------------------------------------
    def test_E_four_bedrooms_three_bathrooms_practical_sizes(self):
        pl = brief(plot_width=40, plot_length=60, road_side="North", building_type="G+1", rooms=rooms_for(4, 3))
        for p in self.exact(pl)["plans"]:
            rooms = [r for f in p["floors"] for r in f["layout"]["rooms"]]
            beds = [r for r in rooms if r["room_type"] in BEDS]
            baths = [r for r in rooms if r["room_type"] == "bathroom"]
            self.assertEqual((len(beds), len(baths)), (4, 3))
            for b in baths:
                self.assertLessEqual(area(b), 80.6, "a bathroom is a small wet room")
                self.assertLessEqual(area(b), 0.7 * min(area(x) for x in beds) + 0.7)
                par = next((x for x in rooms if x["id"] == b.get("attached_to")), None)
                if par is not None:
                    self.assertLessEqual(area(b), BATH_MAX_SHARE_OF_PARENT * area(par) + 0.7)
            for b in beds:
                self.assertGreaterEqual(area(b), 80)

    # H / I ------------------------------------------------------------------------------------------------------------------------
    def test_H_terrace_off_gives_no_terrace(self):
        pl = brief(plot_width=50, plot_length=60, road_side="North", building_type="G+1", rooms=rooms_for(4, 3), include_terrace=False)
        for p in self.exact(pl)["plans"]:
            self.assertFalse((p.get("terrace") or {}).get("exists"))
            for fl in p["floors"]:
                self.assertFalse([r for r in fl["layout"]["rooms"] if r["room_type"] in ("open_terrace", "balcony")])
                for ra in fl["layout"].get("roof_areas", []):               # a bare flat roof is not a terrace: no door, no node, no room
                    self.assertIn("flat_roof", ra["id"])
                    self.assertFalse([d for d in fl["layout"]["openings"]["doors"] if ra["id"] in (d.get("room"), d.get("connects_to"))])

    def test_I_terrace_on_gives_terrace_and_no_extra_floor(self):
        pl = brief(plot_width=50, plot_length=60, road_side="North", building_type="G+1", rooms=rooms_for(4, 3), include_terrace=True)
        res = generate(pl)
        self.assertNotIsInstance(res, Exception, str(res))
        for p in res["plans"]:
            self.assertEqual(len(p["floors"]), 2, "a terrace never adds a floor")
            self.assertTrue(p["terrace"]["exists"])
            self.assertTrue(p["ledger"]["ok"], [v["message"] for v in p["ledger"]["violations"]])
            self.assertEqual(counts(p).get("open_terrace", 0), 0, "the terrace is the roof, not a room on an upper floor")

    # J ----------------------------------------------------------------------------------------------------------------------------
    def test_J_one_car_parking(self):
        pl = brief(plot_width=40, plot_length=60, road_side="South", building_type="G+1", rooms=rooms_for(3, 3),
                   parking_required=True, parking_spaces=1, parking_type="1 Car")
        for p in self.exact(pl)["plans"]:
            ground = p["floors"][0]["layout"]
            self.assertEqual(len([r for r in ground["rooms"] if r["room_type"] == "parking"]), 1)
            bays = [b for rg in ground["usable_plot"].get("reserved_regions", []) for b in rg.get("bays", [])]
            self.assertEqual(len(bays), 1, "one car, one bay")
            for fl in p["floors"][1:]:
                self.assertFalse([r for r in fl["layout"]["rooms"] if r["room_type"] in ("parking", "bike_parking")])

    # K ----------------------------------------------------------------------------------------------------------------------------
    def test_K_combination(self):
        pl = brief(plot_width=50, plot_length=60, frontage_ft=60, road_side="West", building_type="G+2", rooms=rooms_for(5, 5),
                   parking_required=True, parking_spaces=1, parking_type="1 Car", include_terrace=True)
        res = generate(pl)
        self.assertNotIsInstance(res, Exception, str(res))
        for p in res["plans"]:
            self.assertEqual(len(p["floors"]), 3)
            self.assertEqual((p["site"]["frontage"], p["site"]["depth"]), (60, 50))
            c = counts(p)
            self.assertEqual((c.get("master_bedroom", 0) + c.get("bedroom", 0), c.get("bathroom", 0), c.get("parking", 0)), (5, 5, 1))
            self.assertTrue(p["terrace"]["exists"])
            self.assertTrue(p["ledger"]["ok"], [v["message"] for v in p["ledger"]["violations"]])
            self.assertEqual(chajja_problems(p), [])

    # G (data) ---------------------------------------------------------------------------------------------------------------------
    def test_G_every_window_has_exactly_one_chajja(self):
        pl = brief(plot_width=40, plot_length=60, road_side="East", building_type="G+2", rooms=rooms_for(4, 4))
        res = self.exact(pl)
        for p in res["plans"]:
            spec = p["chajja_spec"]
            n = 0
            for fl in p["floors"]:
                for w in fl["layout"]["openings"]["windows"]:
                    n += 1
                    c = w["chajja"]
                    self.assertEqual((c["wall"], c["room"], c["position"]), (w["wall"], w["room"], w["position"]), "same wall, same window")
                    self.assertGreaterEqual(c["width"], w["width"])
                    self.assertEqual((c["projection"], c["thickness"]), (spec["projection"], spec["thickness"]))
            self.assertGreater(n, 0)

    def test_G_chajja_dimensions_are_configurable(self):
        pl = brief(plot_width=40, plot_length=40, road_side="North", building_type="Ground", rooms=rooms_for(2, 2),
                   chajja_projection_ft=2.0, chajja_thickness_ft=0.4)
        res = self.exact(pl)
        for fl in res["plans"][0]["floors"]:
            for w in fl["layout"]["openings"]["windows"]:
                self.assertEqual((w["chajja"]["projection"], w["chajja"]["thickness"]), (2.0, 0.4))

    def test_G_missing_chajja_is_a_hard_violation(self):
        res = generate(brief(plot_width=40, plot_length=40, road_side="North", building_type="Ground", rooms=rooms_for(2, 2)))
        p = res["plans"][0]
        import copy
        q = copy.deepcopy(p)
        q["floors"][0]["layout"]["openings"]["windows"][0].pop("chajja")
        v = violations(build_spec(brief(plot_width=40, plot_length=40, road_side="North", building_type="Ground", rooms=rooms_for(2, 2))), q)
        self.assertIn("CHAJJA", [x["code"] for x in v])

    # infeasible -------------------------------------------------------------------------------------------------------------------
    def test_infeasible_brief_is_reported_not_marked_successful(self):
        pl = brief(plot_width=20, plot_length=30, road_side="South", building_type="G+1", rooms=rooms_for(4, 4),
                   parking_required=True, parking_spaces=2, parking_type="2 Cars")
        res = generate(pl)
        if isinstance(res, Exception):                                      # the expected outcome: a precise conflict, no plan
            self.assertIsInstance(res, service.NoLayout)
            self.assertTrue(str(res))
            self.assertNotIn("add a floor", str(res).lower())
        else:                                                               # or, at the very most, an honest "closest alternative"
            self.assertNotEqual(res.get("status"), "ok")
            for p in res["plans"]:
                self.assertEqual(len(p["floors"]), 2, "the floor count is never changed to compensate")

    def test_validator_rejects_wrong_counts_and_floors(self):
        pl = brief(plot_width=40, plot_length=40, road_side="North", building_type="Ground", rooms=rooms_for(2, 2))
        p = generate(pl)["plans"][0]
        import copy
        q = copy.deepcopy(p)
        q["floors"][0]["layout"]["rooms"] = [r for r in q["floors"][0]["layout"]["rooms"] if r["room_type"] != "dining"]
        self.assertIn("MISSING_ROOM", [x["code"] for x in violations(build_spec(pl), q)])
        q = copy.deepcopy(p)
        q["floors"].append(copy.deepcopy(q["floors"][0]))
        self.assertIn("FLOORS", [x["code"] for x in violations(build_spec(pl), q)])
        q = copy.deepcopy(p)
        q["floors"][0]["layout"]["rooms"].append(dict(q["floors"][0]["layout"]["rooms"][0], id="living_room_2"))
        self.assertTrue({"EXTRA_ROOM"} & {x["code"] for x in violations(build_spec(pl), q)})


# L ----------------------------------------------------------------------------------------------------------------------------
class LegacyUploadStackStaysRemoved(unittest.TestCase):
    """The old OCR / computer-vision import stays gone. Its replacement is the Gemini reading + user-approved scale workflow (backend/planimport, tests/test_plan_import.py)."""
    PATTERN = re.compile(r"import-plan|plan_vision|plan_faithful|rapidocr|opencv|faithful", re.I)

    def test_L_legacy_routes_gone_new_ones_present(self):
        from backend.main import app
        paths = set(app.openapi()["paths"])
        self.assertFalse([p for p in paths if "import-plan" in p or "upload" in p], paths)
        self.assertIn("/generate", paths)
        self.assertTrue([p for p in paths if p.startswith("/plan-import/")], paths)

    def test_L_no_upload_modules_or_dependencies(self):
        for name in ("plan_exterior", "plan_faithful", "plan_import", "plan_ir", "plan_model", "plan_text", "plan_validate", "plan_vision", "plan_walls"):
            self.assertFalse((ROOT / "backend" / "planner" / f"{name}.py").exists(), name)
        reqs = (ROOT / "backend" / "requirements.txt").read_text().lower()
        for dep in ("opencv", "rapidocr", "numpy"):
            self.assertNotIn(dep, reqs)
        for f in ("ImportPlan.tsx", "ImportedPlanSvg.tsx"):   # the old components; the new wizard lives in pages/UploadWizard.tsx
            self.assertFalse((ROOT / "frontend-react" / "src" / "components" / f).exists(), f)

    def test_L_sources_do_not_mention_the_feature(self):
        hits = []
        for base in (ROOT / "backend", ROOT / "frontend-react" / "src"):
            for f in base.rglob("*"):
                if f.suffix in (".py", ".ts", ".tsx") and "__pycache__" not in f.parts and f.name != "test_strict_compliance.py":
                    if self.PATTERN.search(f.read_text(errors="ignore")):
                        hits.append(str(f.relative_to(ROOT)))
        self.assertEqual(hits, [])

    def test_L_generated_plan_to_3d_inputs_exist(self):
        """The workflow requirements -> 2D plan -> 3D needs only /generate: a plan carries everything the 3D builder reads."""
        res = generate(brief(plot_width=40, plot_length=40, road_side="North", building_type="Ground", rooms=rooms_for(2, 2)))
        p = res["plans"][0]
        lay = p["floors"][0]["layout"]
        for k in ("rooms", "plot", "openings", "usable_plot"):
            self.assertIn(k, lay)
        self.assertIn("staircase", p)


if __name__ == "__main__":
    unittest.main()
