"""The 3D design studio (themes, interior / exterior options, day / evening) in a real browser.

Uses the dev harness ``frontend-react/dev/twin.html`` (the production ``<TwinViewer>`` on a stored plan) so no API is needed.
Checks, for every one of the seven themes, that

* the picture really changes (different rendered pixels),
* the building does not: the structure hash, the furniture-layout hash and the world-space bounding box of the model are identical,
* Day / Evening switch the room lights on and off without touching the geometry, and "Reset" returns to the default,
* the exported .glb keeps the geometry (same boxes for every theme) and carries materials and textures,
* nothing is logged as an error.

Software GL (SwiftShader) is slow, so it is ~2-3 minutes.  Skipped when playwright / node_modules / a browser are missing."""
import hashlib
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

import numpy as np

from tests import glb_tools

ROOT = Path(__file__).resolve().parents[1]
THEMES = ["wood_classic", "colorful_modern", "luxury_marble", "modern_luxury", "scandinavian", "industrial", "premium_contemporary"]
PORT = 5173


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


class TwinDesignStudio(unittest.TestCase):
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
        cls.dir = tempfile.mkdtemp()
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
        out = {"themes": {}, "errors": []}
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
            pg = b.new_page(viewport={"width": 1500, "height": 1100}, accept_downloads=True)
            pg.set_default_timeout(240000)
            pg.on("pageerror", lambda e: out["errors"].append(str(e)))
            pg.on("console", lambda m: out["errors"].append(m.text) if m.type == "error" else None)
            pg.goto(f"http://127.0.0.1:{PORT}/dev/twin.html?plan=g1_0&h=700")
            pg.wait_for_function("window.__twin && window.__twin.model", timeout=240000)
            out["cards"] = pg.locator("[data-testid^=theme-]").count()
            out["thumbs"] = pg.locator("[data-testid^=theme-] img").count()
            out["sections"] = [pg.get_by_test_id("section-interior").count(), pg.get_by_test_id("section-exterior").count()]
            out["default_pressed"] = pg.get_by_test_id("theme-wood_classic").get_attribute("aria-pressed")

            def state():
                return pg.evaluate("""() => { const T = window.__twin, m = T.model; T.invalidate(); T.render();
                    return { sig: m.sig, size: m.size, lights: m.lights.filter(l => l.light.visible).length, nlights: m.lights.length } }""")

            def shot():
                png = pg.get_by_test_id("twin-canvas").screenshot()
                from io import BytesIO
                from PIL import Image
                arr = np.asarray(Image.open(BytesIO(png)).convert("RGB"), dtype=np.int16)
                return {"hash": hashlib.sha1(png).hexdigest(), "img": arr}

            def glb(name):
                with pg.expect_download(timeout=240000) as d:
                    pg.get_by_role("button", name="Download 3D model (.glb)").click()
                path = os.path.join(cls.dir, name + ".glb")
                d.value.save_as(path)
                return path

            for t in THEMES:
                pg.get_by_test_id(f"theme-{t}").click()
                pg.wait_for_timeout(1500)
                s = state()
                s["shot"] = shot()
                s["pressed"] = pg.get_by_test_id(f"theme-{t}").get_attribute("aria-pressed")
                if t in ("wood_classic", "luxury_marble", "industrial"):
                    s["glb"] = glb(t)
                out["themes"][t] = s
            # day / evening, then reset
            pg.get_by_test_id("theme-modern_luxury").click()
            pg.get_by_test_id("time-day").click()
            pg.wait_for_timeout(800)
            out["day"] = state()
            pg.get_by_test_id("time-evening").click()
            pg.wait_for_timeout(1500)
            out["evening"] = state()
            out["evening"]["shot"] = shot()
            pg.get_by_test_id("time-day").click()
            pg.wait_for_timeout(800)
            out["day"]["shot"] = shot()
            pg.get_by_test_id("design-reset").click()
            pg.wait_for_timeout(1500)
            out["reset"] = state()
            out["reset"]["pressed"] = pg.get_by_test_id("theme-wood_classic").get_attribute("aria-pressed")
            out["reset"]["time"] = pg.get_by_test_id("time-day").get_attribute("aria-pressed")
            out["reset"]["shot"] = shot()
            # a single option (floor) changes the picture but not the building
            row = pg.locator("[data-testid=row-floor]")
            if row.count():
                btn = row.locator("button[aria-pressed=false]").first
                btn.click()
                pg.wait_for_timeout(1500)
                out["option"] = state()
                out["option"]["shot"] = shot()
            b.close()
        return out

    def test_seven_theme_cards_with_previews_and_both_sections(self):
        self.assertEqual(self.data["cards"], 7)
        self.assertEqual(self.data["thumbs"], 7, "every card shows a rendered preview")
        self.assertEqual(self.data["sections"], [1, 1], "separate Interior / Exterior sections")
        self.assertEqual(self.data["default_pressed"], "true")

    def test_every_theme_looks_different(self):
        shots = [self.data["themes"][t]["shot"]["hash"] for t in THEMES]
        self.assertEqual(len(set(shots)), 7, "each theme renders a different picture")
        base = self.data["themes"][THEMES[0]]["shot"]["img"]
        for t in THEMES[1:]:
            self.assertGreater(np.abs(self.data["themes"][t]["shot"]["img"] - base).mean(), 2.0, f"{t} is visibly different from the default")
        for t in THEMES:
            self.assertEqual(self.data["themes"][t]["pressed"], "true")

    def test_theme_never_changes_the_building(self):
        ref = self.data["themes"][THEMES[0]]
        for t in THEMES[1:]:
            s = self.data["themes"][t]
            self.assertEqual(s["sig"]["struct"], ref["sig"]["struct"], f"{t}: structure changed")
            self.assertEqual(s["sig"]["furniture"], ref["sig"]["furniture"], f"{t}: furniture layout changed")
            np.testing.assert_allclose(s["size"], ref["size"], err_msg=f"{t}: size changed")

    def test_day_evening_lights_and_reset(self):
        d, e, r = self.data["day"], self.data["evening"], self.data["reset"]
        self.assertEqual(d["lights"], 0, "no room lights in daylight")
        self.assertGreater(e["lights"], 0, "room lights are on in the evening")
        self.assertGreater(np.abs(d["shot"]["img"] - e["shot"]["img"]).mean(), 10.0, "evening is visibly different from day")
        self.assertEqual(e["sig"], d["sig"], "evening does not change the geometry")
        self.assertEqual(r["pressed"], "true")
        self.assertEqual(r["time"], "true")
        self.assertLess(np.abs(r["shot"]["img"] - self.data["themes"]["wood_classic"]["shot"]["img"]).mean(), 1.0, "reset restores the default look")
        if "option" in self.data:
            self.assertGreater(np.abs(self.data["option"]["shot"]["img"] - r["shot"]["img"]).mean(), 0.3, "an interior option changes the picture")
            self.assertEqual(self.data["option"]["sig"], r["sig"], "an interior option never moves anything")

    def test_glb_keeps_geometry_and_has_materials_and_textures(self):
        files = {t: self.data["themes"][t]["glb"] for t in ("wood_classic", "luxury_marble", "industrial")}
        boxes = {}
        for t, f in files.items():
            j = glb_tools.load(f)
            self.assertGreater(len(j.get("materials", [])), 10, f"{t}: materials exported")
            self.assertGreater(len(j.get("textures", [])), 5, f"{t}: textures exported")
            self.assertGreater(len(j.get("images", [])), 5)
            self.assertLess(os.path.getsize(f), 40 * 1024 * 1024, f"{t}: file size")
            self.assertTrue(any(m.get("pbrMetallicRoughness", {}).get("roughnessFactor", 1) < 1 for m in j["materials"]), "PBR roughness present")
            lo, hi = glb_tools.bbox(j)
            boxes[t] = np.concatenate([lo, hi])
        # the building is the same in every file (parts of furniture are merged per material, so compare the overall extent)
        for t in ("luxury_marble", "industrial"):
            np.testing.assert_allclose(boxes[t], boxes["wood_classic"], atol=0.02, err_msg=f"{t}: extent differs")

    def test_no_console_errors(self):
        self.assertEqual([e for e in self.data["errors"] if "GL Driver" not in e and "GPU stall" not in e], [])


if __name__ == "__main__":
    unittest.main()
