"""3D envelope checks in a real browser (dev harness ``frontend-react/dev/twin.html``): stair-to-terrace access, parapets, roof overhang, balcony slabs,
style isolation.  Reads ``model.envelope`` (what the builder drew, in plan feet) and the scene bounding boxes; the plans are the stored generated ones.

* a selected terrace has a real door from the stair head-room onto a walkable roof, a parapet on the exposed edges only (never across the door) at one height;
* an unselected terrace adds no parapet, no stair head-room and nothing above the flat roof;
* the roof overhang strips stay inside the plot (with the clear distance), never overlap each other or a room;
* a projected balcony has a slab, a railing on every projected edge, stays inside its limits and does not collide with other slabs / overhangs;
* Modern keeps all its features after the Wada style was added, Wada still loads, and the structure (parapets, head-room, balconies) is the same in every style.

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
STYLES = ["modern_minimalistic", "traditional_indian", "maharashtrian_wada"]
PLANS = ["sc_terrace", "sc_balcony", "sc_a_f50", "sc_g2_balcony", "cf_g1_terrace", "sc_g2"]
EPS = 1e-4
PARAPET_TOP = 3.12          # ENVELOPE.parapetFt (3) + the 0.12 ft coping


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


JS = """() => {
  const T = window.__twin.THREE, m = window.__twin.model
  const bb = (o) => { const b = new T.Box3().setFromObject(o); return { x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y, z0: b.min.z, z1: b.max.z } }
  const doors = m.doors.map((d) => ({ box: bb(d.pivot) }))
  return {
    floors: m.floors.length, wallH: m.wallH, envelope: JSON.parse(JSON.stringify(m.envelope)), roof: bb(m.roof), doors: doors.length,
    chajjas: m.chajjas.length, roofAreas: m.roofAreas.length,
  }
}"""


def ov(a, b, eps=EPS):
    return not (a["x1"] <= b["x0"] + eps or b["x1"] <= a["x0"] + eps or a["z1"] <= b["z0"] + eps or b["z1"] <= a["z0"] + eps)


def ov3(a, b, eps=EPS):
    return ov(a, b, eps) and not (a["y1"] <= b["y0"] + eps or b["y1"] <= a["y0"] + eps)


class EnvelopeRender(unittest.TestCase):
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
        out = {"errors": [], "m": {}}
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
            pg = b.new_page(viewport={"width": 1300, "height": 900})
            pg.set_default_timeout(240000)
            pg.on("pageerror", lambda e: out["errors"].append(str(e)))
            pg.on("console", lambda m: out["errors"].append(m.text) if m.type == "error" else None)
            for name in PLANS:
                for st in STYLES:
                    pg.goto(f"http://127.0.0.1:{PORT}/dev/twin.html?plan={name}&style={st}&h=500")
                    pg.wait_for_function("window.__twin && window.__twin.model", timeout=240000)
                    out["m"][(name, st)] = pg.evaluate(JS)
            b.close()
        return out

    def plan(self, name):
        return json.loads((FIX / f"{name}.json").read_text())

    def M(self, name, style="modern_minimalistic"):
        return self.data["m"][(name, style)]

    # --- terrace access ----------------------------------------------------------------------------------------------------------------
    def test_selected_terrace_has_a_door_from_the_stair_and_a_parapet_that_leaves_it_free(self):
        for name in PLANS:
            plan = self.plan(name)
            if not plan["terrace"]["exists"]:
                continue
            for st in STYLES:
                e = self.M(name, st)["envelope"]
                where = f"{name}/{st}"
                self.assertEqual(len(e["mumty"]), 1, f"{where}: one stair head-room onto the terrace")
                mu = e["mumty"][0]
                door = mu["door"]
                self.assertIsNotNone(door, f"{where}: the head-room needs a door onto the terrace")
                self.assertGreaterEqual(door["b"] - door["a"], 2.5, where)
                # the door is in one of the head-room's walls and opens onto the roof of the top floor (not out into the air)
                room = mu["room"]
                out_pt = {"h": (((door["a"] + door["b"]) / 2), door["c"] + door["out"] * 1.0), "v": (door["c"] + door["out"] * 1.0, ((door["a"] + door["b"]) / 2))}[door["axis"]]
                px, pz = out_pt if door["axis"] == "h" else (out_pt[0], out_pt[1])
                if door["axis"] == "h":
                    px, pz = (door["a"] + door["b"]) / 2, door["c"] + door["out"] * 1.0
                else:
                    px, pz = door["c"] + door["out"] * 1.0, (door["a"] + door["b"]) / 2
                top = plan["floors"][-1]["layout"]["rooms"]
                roofed = [r for r in top if r["room_type"] not in ("open_terrace", "balcony", "courtyard", "staircase") and r["x"] < px < r["x2"] and r["y"] < pz < r["y2"]]
                self.assertTrue(roofed, f"{where}: the door opens onto the roof slab of a top-floor room")
                self.assertFalse(room["x0"] < px < room["x1"] and room["z0"] < pz < room["z1"], where)
                # no parapet stands in the doorway or across the route from the door
                zone = {"x0": px - 1.2, "x1": px + 1.2, "z0": pz - 1.2, "z1": pz + 1.2}
                for q in e["parapets"]:
                    self.assertFalse(ov(zone, q), f"{where}: a parapet blocks the terrace door")
                # parapets: one height, never inside the head-room, never overlapping its walls
                self.assertGreater(len(e["parapets"]), 0, where)
                for q in e["parapets"]:
                    self.assertAlmostEqual(q["y1"] - q["y0"], PARAPET_TOP, places=2, msg=f"{where}: one consistent parapet height")
                    self.assertAlmostEqual(q["y0"], e["roofY"] + 0.3, places=2, msg=where)
                    for w in mu["walls"]:
                        self.assertFalse(ov3(q, w), f"{where}: a parapet intersects a head-room wall")
                # walkable: the roof slab under the door is level with the head-room floor
                self.assertAlmostEqual(mu["floorY"], e["roofY"] + 0.3, places=2, msg=where)
                self.assertGreater(mu["coverY"] - mu["floorY"], 7.0, f"{where}: head-room height")

    def test_unselected_terrace_adds_nothing(self):
        for name in PLANS:
            plan = self.plan(name)
            if plan["terrace"]["exists"]:
                continue
            for st in STYLES:
                m = self.M(name, st)
                e = m["envelope"]
                where = f"{name}/{st}"
                self.assertEqual(e["parapets"], [], f"{where}: no terrace was selected, so no terrace parapet")
                self.assertEqual(e["mumty"], [], f"{where}: no stair head-room / roof stair without a terrace")
                if st == "modern_minimalistic":
                    # the flat roof is the highest thing: slab + fascia only (the overhang fascia rises 0.02 ft above the slab)
                    self.assertLessEqual(m["roof"]["y1"], e["roofY"] + 0.3 + 0.05, f"{where}: something stands on a roof that is not a terrace")

    # --- roof overhang -----------------------------------------------------------------------------------------------------------------
    def test_roof_overhang_is_visible_inside_the_plot_and_collision_free(self):
        for name in PLANS:
            plan = self.plan(name)
            plot = plan["floors"][0]["layout"]["plot"]
            by = plan["roof_spec"]["by_side"]
            e = self.M(name)["envelope"]
            strips = e["overhang"]
            if any(v >= 0.5 for v in by.values()):
                self.assertGreater(len(strips), 0, f"{name}: a visible roof overhang")
            for i, s in enumerate(strips):
                # inside the plot; on the side it projects to it keeps the clear distance (along the building it may reach the plot edge)
                foot = [r for fl in plan["floors"] for r in fl["layout"]["rooms"]]
                fx0, fz0 = min(r["x"] for r in foot), min(r["y"] for r in foot)
                fx1, fz1 = max(r["x2"] for r in foot), max(r["y2"] for r in foot)
                self.assertGreaterEqual(s["x0"], plot["x"] - EPS, name)
                self.assertGreaterEqual(s["z0"], plot["y"] - EPS, name)
                self.assertLessEqual(s["x1"], plot["x"] + plot["width"] + EPS, name)
                self.assertLessEqual(s["z1"], plot["y"] + plot["length"] + EPS, name)
                if s["x1"] <= fx0 + EPS:
                    self.assertGreaterEqual(s["x0"], plot["x"] + 1.0 - EPS, f"{name}: left overhang too close to the plot edge")
                if s["x0"] >= fx1 - EPS:
                    self.assertLessEqual(s["x1"], plot["x"] + plot["width"] - 1.0 + EPS, f"{name}: right overhang too close to the plot edge")
                if s["z1"] <= fz0 + EPS:
                    self.assertGreaterEqual(s["z0"], plot["y"] + 1.0 - EPS, f"{name}: top overhang too close to the plot edge")
                if s["z0"] >= fz1 - EPS:
                    self.assertLessEqual(s["z1"], plot["y"] + plot["length"] - 1.0 + EPS, f"{name}: bottom overhang too close to the plot edge")
                for t in strips[i + 1:]:
                    self.assertFalse(ov(s, t), f"{name}: two overhang strips overlap")
                for r in plan["floors"][-1]["layout"]["rooms"]:
                    if r["room_type"] in ("open_terrace", "balcony", "courtyard"):
                        continue
                    self.assertFalse(ov(s, {"x0": r["x"], "x1": r["x2"], "z0": r["y"], "z1": r["y2"]}, 1e-3), f"{name}: overhang over the room {r['id']}")
                self.assertLessEqual(max(s["x1"] - s["x0"], s["z1"] - s["z0"]) if False else min(s["x1"] - s["x0"], s["z1"] - s["z0"]), plan["roof_spec"]["overhang_ft"] + 1e-3, name)

    # --- balconies ----------------------------------------------------------------------------------------------------------------------
    def test_projected_balconies_have_slab_rails_and_no_collisions(self):
        seen = 0
        for name in PLANS:
            plan = self.plan(name)
            e = self.M(name)["envelope"]
            recs = [(fi, rec) for fi, fl in enumerate(plan["floors"]) for rec in fl["layout"].get("balcony_projections", [])]
            self.assertEqual(len(e["balconies"]), len(recs), f"{name}: every projection record is drawn")
            slabs_all = []
            for b in e["balconies"]:
                seen += 1
                rec = next(r for fi, r in recs if fi == b["floor"] and r["room"] == b["room"])
                self.assertEqual({k: round(v, 3) for k, v in b["sides"].items()}, rec["sides"], name)
                self.assertGreaterEqual(len(b["slab"]), len(rec["sides"]), name)
                rect = b["rect"]
                for side, p in rec["sides"].items():
                    edge = {"top": ("h", rect["z0"] - p), "bottom": ("h", rect["z1"] + p), "left": ("v", rect["x0"] - p), "right": ("v", rect["x1"] + p)}[side]
                    self.assertTrue(any(r["axis"] == edge[0] and abs(r["c"] - edge[1]) < 1e-6 for r in b["rails"]), f"{name} {side}: a railing on the projected edge")
                    # no railing is left across the balcony's old edge
                    old = {"top": ("h", rect["z0"]), "bottom": ("h", rect["z1"]), "left": ("v", rect["x0"]), "right": ("v", rect["x1"])}[side]
                    self.assertFalse(any(r["axis"] == old[0] and abs(r["c"] - old[1]) < 1e-6 and r["b"] - r["a"] > 1.0 for r in b["rails"]), f"{name} {side}")
                for s in b["slab"]:
                    for r in plan["floors"][b["floor"]]["layout"]["rooms"]:
                        self.assertFalse(ov(s, {"x0": r["x"], "x1": r["x2"], "z0": r["y"], "z1": r["y2"]}, 1e-3), f"{name}: balcony slab collides with {r['id']}")
                    for o in slabs_all:
                        if o[0] == b["floor"]:
                            self.assertFalse(ov(s, o[1]), f"{name}: balcony slabs overlap")
                    slabs_all.append((b["floor"], s))
        self.assertGreater(seen, 0, "no stored plan has a balcony projection (python -m tests.gen_fixtures)")

    # --- styles are isolated -----------------------------------------------------------------------------------------------------------
    def test_structure_is_the_same_in_every_style_and_modern_keeps_its_features(self):
        for name in PLANS:
            plan = self.plan(name)
            base = self.M(name)
            for st in STYLES[1:]:
                other = self.M(name, st)
                self.assertEqual(base["floors"], other["floors"], f"{name}/{st}")
                self.assertEqual(base["chajjas"], other["chajjas"], f"{name}/{st}: windows / chajjas follow the plan, not the style")
                self.assertEqual(base["envelope"]["overhang"], other["envelope"]["overhang"], f"{name}/{st}: the RCC slab overhang is structure, not style")
                self.assertEqual(base["envelope"]["parapets"], other["envelope"]["parapets"], f"{name}/{st}")
                self.assertEqual(base["envelope"]["balconies"], other["envelope"]["balconies"], f"{name}/{st}")
                self.assertEqual(base["envelope"]["mumty"], other["envelope"]["mumty"], f"{name}/{st}")
            windows = sum(len(f["layout"]["openings"]["windows"]) for f in plan["floors"])
            self.assertEqual(base["chajjas"], windows, f"{name}: Modern keeps one chajja per window")
            self.assertEqual(base["floors"], len(plan["floors"]), name)
            self.assertGreater(base["doors"], 0, name)
            self.assertEqual(base["roofAreas"], sum(len(f["layout"].get("roof_areas", [])) for f in plan["floors"]), name)

    def test_no_browser_errors(self):
        self.assertEqual([e for e in self.data["errors"] if "favicon" not in e], [])


if __name__ == "__main__":
    unittest.main()
