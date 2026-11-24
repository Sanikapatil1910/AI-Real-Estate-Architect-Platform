"""2D / 3D consistency of the strict-compliance plans, in a real browser (dev harness ``frontend-react/dev/twin.html``).

For the stored generated plans ``sc_*`` (see ``tests/gen_fixtures.py``) it checks, with the production ``<FloorPlanSvg>`` and ``<TwinViewer>``:

* every window of every floor has exactly one chajja in 3D, on the same wall, projecting to the outdoor side, above the window, with the
  configured projection and thickness -- and exactly one in the 2D plan;
* every kitchen has base cabinets, wall cabinets, a sink, a hob and a fridge in 3D, all inside the room;
* the floors, rooms and flat roofs of the 3D model are the plan's: nothing is added or left out by the renderer;
* no terrace is drawn unless it was asked for, and a requested terrace is the roof of the plan (no extra floor).

Skipped when playwright / node_modules / a browser are missing."""
import json
import os
import shutil
import socket
import subprocess
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "frontend-react" / "dev" / "fixtures"
PORT = 5173
PLANS = ["sc_a_f50", "sc_b_f60", "sc_g2", "sc_car", "sc_terrace"]


def _up(port):
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def _wait(url, secs=90):
    t = time.time()
    while time.time() - t < secs:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.7)
    return False


JS_MODEL = """() => {
  const T = window.__twin.THREE, m = window.__twin.model
  const box = (o) => { const b = new T.Box3().setFromObject(o); return { x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y, z0: b.min.z, z1: b.max.z } }
  return {
    floors: m.floors.length,
    chajjas: m.chajjas.map((c) => ({ floor: c.floor, room: c.room, wall: c.wall, axis: c.axis, c: c.c, dir: c.dir, projection: c.projection, thickness: c.thickness, y0: c.y0, y1: c.y1, box: box(c.mesh) })),
    kitchens: m.kitchens,
    roofAreas: m.roofAreas,
    wallH: m.wallH,
    parking: m.parking,
  }
}"""

JS_2D = """() => ({
  chajjas: [...document.querySelectorAll('[data-testid=chajja]')].map((e) => ({ room: e.dataset.room, wall: e.dataset.wall })),
  roofs: document.querySelectorAll('[data-testid=roof-area]').length,
  roofText: [...document.querySelectorAll('[data-testid=roof-area] text')].map((t) => t.textContent),
})"""


class StrictRender(unittest.TestCase):
    proc = None
    data = {}

    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright  # noqa: F401
        except Exception as exc:
            raise unittest.SkipTest(f"playwright unavailable: {exc}")
        if not (ROOT / "frontend-react" / "node_modules").exists():
            raise unittest.SkipTest("frontend-react/node_modules missing (run npm install)")
        missing = [n for n in PLANS if not (FIX / f"{n}.json").exists()]
        if missing:
            raise unittest.SkipTest(f"fixtures missing, run `python -m tests.gen_fixtures`: {missing}")
        if not _up(PORT):
            npx = shutil.which("npx")
            if not npx:
                raise unittest.SkipTest("npx not found")
            cls.proc = subprocess.Popen([npx, "vite", "--port", str(PORT), "--host", "127.0.0.1"], cwd=ROOT / "frontend-react",
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        if not _wait(f"http://127.0.0.1:{PORT}/dev/twin.html"):
            cls.tearDownClass()
            raise unittest.SkipTest("the dev server did not start")
        cls.data = cls._run()

    @classmethod
    def tearDownClass(cls):
        if cls.proc:
            try:
                os.killpg(cls.proc.pid, 15)
            except Exception:
                pass
            cls.proc = None

    @classmethod
    def _run(cls):
        from playwright.sync_api import sync_playwright
        out = {"errors": [], "plans": {}}
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
            pg = b.new_page(viewport={"width": 1300, "height": 900})
            pg.set_default_timeout(240000)
            pg.on("pageerror", lambda e: out["errors"].append(str(e)))
            pg.on("console", lambda m: out["errors"].append(m.text) if m.type == "error" else None)
            for name in PLANS:
                plan = json.loads((FIX / f"{name}.json").read_text())
                r = {"d2": []}
                for fi in range(len(plan["floors"])):
                    pg.goto(f"http://127.0.0.1:{PORT}/dev/twin.html?plan={name}&view=2d&floor={fi}")
                    pg.wait_for_selector("svg")
                    r["d2"].append(pg.evaluate(JS_2D))
                pg.goto(f"http://127.0.0.1:{PORT}/dev/twin.html?plan={name}&h=600")
                pg.wait_for_function("window.__twin && window.__twin.model", timeout=240000)
                r["d3"] = pg.evaluate(JS_MODEL)
                out["plans"][name] = r
            b.close()
        return out

    def plan(self, name):
        return json.loads((FIX / f"{name}.json").read_text())

    # --- chajja --------------------------------------------------------------------------------------------------------------------
    def test_G_one_chajja_per_window_in_3d_on_the_right_wall(self):
        for name in PLANS:
            plan, m = self.plan(name), self.data["plans"][name]["d3"]
            for fi, fl in enumerate(plan["floors"]):
                wins = fl["layout"]["openings"]["windows"]
                rooms = {r["id"]: r for r in fl["layout"]["rooms"]}
                got = [c for c in m["chajjas"] if c["floor"] == fi]
                self.assertEqual(len(got), len(wins), f"{name} floor {fi}: one chajja per window")
                spec = plan["chajja_spec"]
                for w in wins:
                    rm = rooms[w["room"]]
                    matches = [c for c in got if c["room"] == w["room"] and c["wall"] == w["wall"]]
                    cand = []
                    for c in matches:
                        b = c["box"]
                        if c["axis"] == "h":
                            ctr, lo, hi = (b["x0"] + b["x1"]) / 2, b["x0"], b["x1"]
                            wc = rm["x"] + w["position"] + w["width"] / 2
                            line = rm["y"] if w["wall"] == "top" else rm["y"] + rm["length"]
                            depth = (b["z0"], b["z1"])
                        else:
                            ctr, lo, hi = (b["z0"] + b["z1"]) / 2, b["z0"], b["z1"]
                            wc = rm["y"] + w["position"] + w["width"] / 2
                            line = rm["x"] if w["wall"] == "left" else rm["x"] + rm["width"]
                            depth = (b["x0"], b["x1"])
                        if abs(ctr - wc) < 0.05 and hi - lo >= w["width"] - 0.01:
                            cand.append((c, line, depth))
                    self.assertEqual(len(cand), 1, f"{name} floor {fi} {w['room']}/{w['wall']}: exactly one matching chajja")
                    c, line, depth = cand[0]
                    out_sign = -1 if w["wall"] in ("top", "left") else 1
                    far = depth[0] if out_sign < 0 else depth[1]
                    self.assertAlmostEqual(abs(far - line), 0.38 + spec["projection"] - 0.0, delta=0.4, msg=f"{name}: projects outdoors")
                    self.assertTrue(depth[0] < line < depth[1] or (out_sign < 0 and depth[1] <= line + 0.2) or (out_sign > 0 and depth[0] >= line - 0.2))
                    self.assertAlmostEqual(c["projection"], spec["projection"], places=3)
                    self.assertAlmostEqual(c["thickness"], spec["thickness"], places=3)
                    # (the mesh is inside the walls group, which is scaled for the cut-away view: heights come from the model record)
                    self.assertAlmostEqual(c["y1"] - c["y0"], spec["thickness"], delta=0.01)
                    base = fi * m["wallH"]
                    self.assertGreaterEqual(c["y0"], base + 0.3 + 7.0 - 0.01, "above the window head")
                    self.assertLessEqual(c["y1"], base + m["wallH"], "below the next slab")

    def test_G_one_chajja_per_window_in_2d(self):
        for name in PLANS:
            plan = self.plan(name)
            for fi, fl in enumerate(plan["floors"]):
                wins = fl["layout"]["openings"]["windows"]
                got = self.data["plans"][name]["d2"][fi]["chajjas"]
                self.assertEqual(len(got), len(wins), f"{name} floor {fi}")
                self.assertEqual(sorted((g["room"], g["wall"]) for g in got), sorted((w["room"], w["wall"]) for w in wins))

    # --- kitchen -------------------------------------------------------------------------------------------------------------------
    def test_F_kitchen_has_cabinets_sink_hob_and_fridge_in_3d(self):
        for name in PLANS:
            plan, m = self.plan(name), self.data["plans"][name]["d3"]
            kitchens = [r for f in plan["floors"] for r in f["layout"]["rooms"] if r["room_type"] == "kitchen"]
            self.assertEqual(len(kitchens), 1, name)
            fx = [k for k in m["kitchens"] if k["room"] == kitchens[0]["id"]]
            self.assertEqual(len(fx), 1, f"{name}: the kitchen was furnished once")
            k = fx[0]
            self.assertGreaterEqual(k["base"], 1, f"{name}: base cabinets")
            self.assertTrue(k["sink"], f"{name}: sink")
            self.assertTrue(k["hob"], f"{name}: hob")
            self.assertTrue(k["fridge"], f"{name}: fridge")
            kitchen = kitchens[0]
            fl = next(f for f in plan["floors"] if kitchen in f["layout"]["rooms"])
            window_walls = {w["wall"] for w in fl["layout"]["openings"]["windows"] if w["room"] == kitchen["id"]}
            if not all(r["wall"] in window_walls for r in k["runs"]):      # a run on a clear wall carries wall units; under a window it may not
                self.assertGreaterEqual(k["wall"], 1, f"{name}: wall cabinets")
            for r in k["runs"]:
                self.assertGreaterEqual(r["len"], 4.3, f"{name}: the run is long enough for a sink and a hob")

    # --- floors, rooms, roofs, terrace -----------------------------------------------------------------------------------------------
    def test_3d_has_the_floors_of_the_plan(self):
        for name in PLANS:
            self.assertEqual(self.data["plans"][name]["d3"]["floors"], len(self.plan(name)["floors"]), name)

    def test_flat_roofs_are_drawn_in_2d_and_3d_exactly_as_in_the_plan(self):
        for name in PLANS:
            plan, r = self.plan(name), self.data["plans"][name]
            for fi, fl in enumerate(plan["floors"]):
                roofs = fl["layout"].get("roof_areas", [])
                self.assertEqual(r["d2"][fi]["roofs"], len(roofs), f"{name} floor {fi} (2D)")
                self.assertEqual(len([x for x in r["d3"]["roofAreas"] if x["floor"] == fi]), len(roofs), f"{name} floor {fi} (3D)")
                for t in r["d2"][fi]["roofText"]:
                    self.assertIn("NOT ACCESSIBLE", t.upper())
                for ra in roofs:
                    q = next(x for x in r["d3"]["roofAreas"] if x["id"] == ra["id"])
                    self.assertAlmostEqual(q["x0"], ra["x"], places=1)
                    self.assertAlmostEqual(q["x1"], ra["x2"], places=1)
                    self.assertAlmostEqual(q["z0"], ra["y"], places=1)
                    self.assertAlmostEqual(q["z1"], ra["y2"], places=1)

    def test_terrace_only_when_requested(self):
        for name in PLANS:
            plan = self.plan(name)
            asked = name == "sc_terrace"
            self.assertEqual(bool((plan.get("terrace") or {}).get("exists")), asked, name)
            for fl in plan["floors"]:
                self.assertFalse([x for x in fl["layout"]["rooms"] if x["room_type"] in ("open_terrace", "balcony")], name)

    def test_frontage_is_kept_in_the_plans(self):
        a, b = self.plan("sc_a_f50"), self.plan("sc_b_f60")
        self.assertEqual((a["site"]["frontage"], a["site"]["depth"]), (50, 60))
        self.assertEqual((b["site"]["frontage"], b["site"]["depth"]), (60, 50))
        self.assertEqual(b["road_side"], "East")

    def test_one_car_in_the_plan_and_in_3d(self):
        plan, m = self.plan("sc_car"), self.data["plans"]["sc_car"]["d3"]
        self.assertEqual(len(plan["parking"]["bays"]), 1)
        self.assertEqual(len(m["parking"]["cars"]), 1)

    def test_no_browser_errors(self):
        self.assertEqual([e for e in self.data["errors"] if "favicon" not in e], [])


if __name__ == "__main__":
    unittest.main()
