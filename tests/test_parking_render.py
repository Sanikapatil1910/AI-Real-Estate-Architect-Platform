"""The parking bay in the 2D plan and the 3D model, in a real browser (dev harness ``frontend-react/dev/twin.html``).

For three stored generated plans (road South / East, one and two floors) it checks that

* the 2D plan (the production ``<FloorPlanSvg>``) draws exactly one bay for one car, inside the porch, with the proportions of the
  plan's bay (turned on an east / west road), and the plan's car glyph stands in it;
* the 3D model (the production ``<TwinViewer>``) parks its one car inside the *same* bay (plan coordinates) in the same porch;
* nothing is logged as an error.

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
PLANS = ["pk_south", "pk_east", "pk_g1"]


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


class ParkingRender(unittest.TestCase):
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
                r = {}
                pg.goto(f"http://127.0.0.1:{PORT}/dev/twin.html?plan={name}&view=2d&floor=0")
                pg.wait_for_selector("svg")
                r["bays2d"] = pg.evaluate("""() => [...document.querySelectorAll('[data-testid=parking-bay]')].map(g => {
                    const rect = g.querySelector('rect').getBoundingClientRect();
                    const porch = g.parentElement.querySelector('rect').getBoundingClientRect();
                    const c = (b) => ({ x: b.x, y: b.y, w: b.width, h: b.height });
                    return { bay: c(rect), porch: c(porch), label: g.textContent }
                })""")
                r["car2d"] = pg.evaluate("""() => { const g = [...document.querySelectorAll('[data-testid=parking-bay]')][0]?.parentElement;
                    if (!g) return null; const rs = [...g.children].filter(e => e.tagName === 'g' && !e.dataset.testid).map(e => e.getBoundingClientRect());
                    return rs.length ? { x: rs[0].x, y: rs[0].y, w: rs[0].width, h: rs[0].height } : null }""")
                pg.goto(f"http://127.0.0.1:{PORT}/dev/twin.html?plan={name}&h=600")
                pg.wait_for_function("window.__twin && window.__twin.model", timeout=240000)
                r["model"] = pg.evaluate("""() => { const m = window.__twin.model; return { parking: m.parking, sig: m.sig } }""")
                out["plans"][name] = r
            b.close()
        return out

    def plan(self, name):
        return json.loads((FIX / f"{name}.json").read_text())

    def test_2d_plan_draws_one_bay_inside_the_porch(self):
        for name in PLANS:
            r = self.data["plans"][name]
            self.assertEqual(len(r["bays2d"]), 1, f"{name}: exactly one bay for one car")
            b = r["bays2d"][0]
            tol = 2.0
            self.assertGreaterEqual(b["bay"]["x"], b["porch"]["x"] - tol, name)
            self.assertGreaterEqual(b["bay"]["y"], b["porch"]["y"] - tol, name)
            self.assertLessEqual(b["bay"]["x"] + b["bay"]["w"], b["porch"]["x"] + b["porch"]["w"] + tol, name)
            self.assertLessEqual(b["bay"]["y"] + b["bay"]["h"], b["porch"]["y"] + b["porch"]["h"] + tol, name)
            bay = self.plan(name)["parking"]["bays"][0]
            self.assertAlmostEqual(b["bay"]["w"] / b["bay"]["h"], bay["width"] / bay["length"], delta=0.03, msg=f"{name}: proportions")
            self.assertIn("CAR BAY", b["label"])

    def test_2d_car_stands_in_the_bay(self):
        for name in PLANS:
            r = self.data["plans"][name]
            car, b = r["car2d"], r["bays2d"][0]["bay"]
            self.assertIsNotNone(car, f"{name}: a car is drawn")
            tol = 2.0
            self.assertGreaterEqual(car["x"], b["x"] - tol, name)
            self.assertGreaterEqual(car["y"], b["y"] - tol, name)
            self.assertLessEqual(car["x"] + car["w"], b["x"] + b["w"] + tol, name)
            self.assertLessEqual(car["y"] + car["h"], b["y"] + b["h"] + tol, name)

    def test_3d_car_is_in_the_same_bay_as_the_2d_plan(self):
        for name in PLANS:
            plan = self.plan(name)
            m = self.data["plans"][name]["model"]["parking"]
            bay = plan["parking"]["bays"][0]
            self.assertEqual(len(m["cars"]), 1, f"{name}: one car in 3D")
            car = m["cars"][0]
            self.assertGreaterEqual(car["x"], bay["x"] - 0.05, name)
            self.assertLessEqual(car["x"], bay["x"] + bay["width"] + 0.05, name)
            self.assertGreaterEqual(car["z"], bay["y"] - 0.05, name)
            self.assertLessEqual(car["z"], bay["y"] + bay["length"] + 0.05, name)
            porch = next(r for r in plan["floors"][0]["layout"]["rooms"] if r["room_type"] == "parking")
            self.assertEqual(m["room"], {k: porch[k] for k in ("x", "y", "width", "length")}, f"{name}: the 3D porch is the plan's porch")

    def test_3d_car_is_centred_on_the_2d_bay(self):
        for name in PLANS:
            bay = self.plan(name)["parking"]["bays"][0]
            car = self.data["plans"][name]["model"]["parking"]["cars"][0]
            self.assertAlmostEqual(car["x"], bay["x"] + bay["width"] / 2, delta=1.5, msg=name)
            self.assertAlmostEqual(car["z"], bay["y"] + bay["length"] / 2, delta=1.5, msg=name)

    def test_no_console_errors(self):
        self.assertEqual([e for e in self.data["errors"] if "GL Driver" not in e and "GPU stall" not in e], [])


if __name__ == "__main__":
    unittest.main()
