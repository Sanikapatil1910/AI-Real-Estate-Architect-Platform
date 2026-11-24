"""The three architectural styles (Modern Minimalistic / Traditional Indian / Maharashtrian Wada) in a real browser.

Uses the dev harness ``frontend-react/dev/twin.html`` (the production ``<TwinViewer>`` on a stored plan JSON, i.e. a plan that was not generated in
this session) on a multi-floor house with lower roofs and on one with a roof terrace.  Checks that

* the style picker offers exactly the three styles (exact names) and the palette cards belong to the selected style,
* an old / unknown style name opens as Modern Minimalistic, and the plan's own style is what the viewer starts with,
* the structure (slabs, walls, stairs) and the furniture layout are identical in both styles, and the furniture stays inside the house,
* Traditional Indian really changes the house (tiled roofs, different picture) while Modern keeps its flat roofs,
* switching back and forth leaves no mixed materials (the Modern model is identical before and after),
* Maharashtrian Wada really changes the house too (carved timber, tiled roofs, its own palettes) and, on a plan that has a courtyard room, builds a real open court
  without moving a wall,
* the exported .glb of each style matches the viewer: the tile material is exported for the two tiled styles only, and the style travels as a node extra.

Software GL (SwiftShader) is slow (a few minutes).  Skipped when playwright / node_modules / a browser are missing."""
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request
from io import BytesIO
from pathlib import Path

import numpy as np

from tests import glb_tools

ROOT = Path(__file__).resolve().parents[1]
PORT = 5173
MODERN = "Modern Minimalistic"
TRAD = "Traditional Indian"
WADA = "Maharashtrian Wada"
PLANS = ["sc_g2", "sc_terrace"]            # G+2 with lean-to roofs over the lower floors, and G+1 with a usable roof terrace

STATE_JS = """() => { const T = window.__twin, m = T.model; T.invalidate(); T.render();
  const mats = new Set(); let meshes = 0, tile = 0;
  m.root.traverse((o) => { if (!o.isMesh) return; meshes++;
    for (const x of (Array.isArray(o.material) ? o.material : [o.material])) { mats.add(x.name + ':' + (x.color ? x.color.getHexString() : '')); if (x.name === 'roof_tile_clay') tile++ } });
  return { sig: m.sig, size: m.size, meshes, tile, mats: [...mats].sort(), style: m.root.userData.architecturalStyle } }"""

FIT_JS = """(bb) => { const T = window.__twin, m = T.model, B = new T.THREE.Box3(); let outside = 0, n = 0;
  for (const g of m.furniture) for (const o of g.children) { if (!o.isMesh) continue; B.setFromObject(o); n++;
    if (B.min.x < bb[0] - 0.6 || B.max.x > bb[1] + 0.6 || B.min.z < bb[2] - 0.6 || B.max.z > bb[3] + 0.6 || B.min.y < -0.1) outside++ }
  return { n, outside } }"""


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


def _bbox(plan):
    rs = [r for f in plan["floors"] for r in f["layout"]["rooms"]]
    x2 = lambda r: r.get("x2", r["x"] + r["width"])
    y2 = lambda r: r.get("y2", r["y"] + r["length"])
    return [min(r["x"] for r in rs), max(x2(r) for r in rs), min(r["y"] for r in rs), max(y2(r) for r in rs)]


class ThreeStyles(unittest.TestCase):
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
        from PIL import Image
        from playwright.sync_api import sync_playwright
        out = {"errors": [], "plans": {}}
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])

            def open_page(plan, style=None):
                pg = b.new_page(viewport={"width": 1500, "height": 1100}, accept_downloads=True)
                pg.set_default_timeout(240000)
                pg.on("pageerror", lambda e: out["errors"].append(str(e)))
                pg.on("console", lambda m: out["errors"].append(m.text) if m.type == "error" else None)
                q = f"?plan={plan}&h=700" + (f"&style={style}" if style else "")
                pg.goto(f"http://127.0.0.1:{PORT}/dev/twin.html{q}")
                pg.wait_for_function("window.__twin && window.__twin.model", timeout=240000)
                pg.wait_for_timeout(1500)
                pg.get_by_role("button", name="Cutaway walls", exact=True).click()   # whole house with its roof, seen from the corner
                pg.get_by_role("button", name="Corner", exact=True).click()
                pg.wait_for_timeout(1500)
                return pg

            def shot(pg):
                png = pg.get_by_test_id("twin-canvas").screenshot()
                return np.asarray(Image.open(BytesIO(png)).convert("RGB"), dtype=np.int16)

            def state(pg):
                return pg.evaluate(STATE_JS)

            def pick(pg, sid):
                pg.get_by_test_id(f"style-{sid}").click()
                pg.wait_for_timeout(2500)

            for plan in PLANS:
                plan_json = json.load(open(ROOT / "frontend-react" / "dev" / "fixtures" / f"{plan}.json"))
                plan_json = plan_json.get("plan", plan_json)
                d = {"bbox": _bbox(plan_json), "floors": len(plan_json["floors"])}
                pg = open_page(plan, MODERN)
                d["style_cards"] = [pg.get_by_test_id(f"style-{i}").inner_text().split("\n")[0] for i in ("modern_minimalistic", "traditional_indian", "maharashtrian_wada")]
                d["n_style_cards"] = pg.locator("[data-testid=style-picker] button").count()
                d["modern_theme_cards"] = pg.locator("[data-testid^=theme-]").count()
                d["pressed_initial"] = pg.get_by_test_id("style-modern_minimalistic").get_attribute("aria-pressed")
                d["modern0"] = state(pg)
                d["modern0"]["shot"] = shot(pg)
                d["modern0"]["fit"] = pg.evaluate(FIT_JS, d["bbox"])
                with pg.expect_download(timeout=240000) as dl:
                    pg.get_by_role("button", name="Download 3D model (.glb)").click()
                dl.value.save_as(os.path.join(cls.dir, f"{plan}_modern.glb"))
                # Traditional Indian
                pick(pg, "traditional_indian")
                d["trad_pressed"] = pg.get_by_test_id("style-traditional_indian").get_attribute("aria-pressed")
                d["trad_theme_cards"] = pg.locator("[data-testid^=theme-]").count()
                d["trad"] = state(pg)
                d["trad"]["shot"] = shot(pg)
                d["trad"]["fit"] = pg.evaluate(FIT_JS, d["bbox"])
                with pg.expect_download(timeout=240000) as dl:
                    pg.get_by_role("button", name="Download 3D model (.glb)").click()
                dl.value.save_as(os.path.join(cls.dir, f"{plan}_trad.glb"))
                # the second Traditional palette is a Traditional palette (no Modern material leaks in)
                pg.locator("[data-testid^=theme-]").nth(1).click()
                pg.wait_for_timeout(2000)
                d["trad2"] = state(pg)
                # repeated switching: no mixed / leftover materials
                for sid in ("modern_minimalistic", "traditional_indian", "modern_minimalistic"):
                    pick(pg, sid)
                d["modern1"] = state(pg)
                d["modern1"]["shot"] = shot(pg)
                pick(pg, "traditional_indian")
                d["trad1"] = state(pg)
                d["trad1"]["shot"] = shot(pg)
                # Maharashtrian Wada
                pick(pg, "maharashtrian_wada")
                d["wada_pressed"] = pg.get_by_test_id("style-maharashtrian_wada").get_attribute("aria-pressed")
                d["wada_theme_cards"] = pg.locator("[data-testid^=theme-]").count()
                d["wada_court_note"] = pg.get_by_test_id("wada-court-note").count()
                d["wada"] = state(pg)
                d["wada"]["shot"] = shot(pg)
                d["wada"]["fit"] = pg.evaluate(FIT_JS, d["bbox"])
                with pg.expect_download(timeout=240000) as dl:
                    pg.get_by_role("button", name="Download 3D model (.glb)").click()
                dl.value.save_as(os.path.join(cls.dir, f"{plan}_wada.glb"))
                pick(pg, "modern_minimalistic")
                d["modern2"] = state(pg)
                pg.close()
                out["plans"][plan] = d
            # a plan that has a courtyard room: Wada builds a real open court, and the walls / rooms are those of the Modern model
            pg = open_page("wada_court", MODERN)
            out["court_modern"] = state(pg)
            pick(pg, "maharashtrian_wada")
            out["court_wada"] = state(pg)
            out["court_note"] = pg.get_by_test_id("wada-court-note").count()
            pg.close()
            # the plan's own style is what the viewer starts with; an old / unknown style name opens as Modern Minimalistic
            pg = open_page("sc_g2", TRAD)
            out["start_trad"] = pg.get_by_test_id("style-traditional_indian").get_attribute("aria-pressed")
            pg.close()
            for legacy in ("Contemporary", "Minimalistic%20Luxury", "Mediterranean", "nonsense"):
                pg = open_page("sc_g2", legacy)
                out.setdefault("legacy", {})[legacy] = [pg.get_by_test_id("style-modern_minimalistic").get_attribute("aria-pressed"), state(pg)["tile"]]
                pg.close()
            b.close()
        return out

    # ------------------------------------------------------------------ tests
    def test_picker_offers_exactly_the_three_styles(self):
        for plan, d in self.data["plans"].items():
            self.assertEqual(d["n_style_cards"], 3, plan)
            self.assertEqual(d["style_cards"], [MODERN, TRAD, WADA], plan)
            self.assertEqual(d["wada_pressed"], "true")
            self.assertEqual(d["wada_theme_cards"], 3, "Maharashtrian Wada offers its own three palettes")
            self.assertEqual(d["wada_court_note"], 1, "no courtyard room in this plan -> the panel says so instead of moving walls")
            self.assertEqual(d["pressed_initial"], "true")
            self.assertEqual(d["trad_pressed"], "true")
            self.assertEqual(d["modern_theme_cards"], 7, "Modern keeps its seven palettes")
            self.assertEqual(d["trad_theme_cards"], 2, "Traditional Indian offers its own palettes only")

    def test_plan_style_is_the_starting_style_and_legacy_names_map_to_modern(self):
        self.assertEqual(self.data["start_trad"], "true")
        for name, (pressed, tiles) in self.data["legacy"].items():
            self.assertEqual(pressed, "true", f"{name} opens as Modern Minimalistic")
            self.assertEqual(tiles, 0, f"{name}: no tile roofs")

    def test_style_never_changes_the_building(self):
        for plan, d in self.data["plans"].items():
            # walls, slabs, stairs and the furniture footprints (where each piece stands) are the same in both styles; the pieces themselves differ
            for k in ("struct", "layout"):
                self.assertEqual(d["trad"]["sig"][k], d["modern0"]["sig"][k], f"{plan}: {k} differs between the styles")
                self.assertEqual(d["trad2"]["sig"][k], d["modern0"]["sig"][k], f"{plan}: {k} differs for the second palette")
            self.assertNotEqual(d["trad"]["sig"]["furniture"], d["modern0"]["sig"]["furniture"], "the heritage pieces are different pieces")
            self.assertEqual(d["trad2"]["sig"]["furniture"], d["trad"]["sig"]["furniture"], "a palette change keeps the pieces")
            for k in ("struct", "layout"):
                self.assertEqual(d["wada"]["sig"][k], d["modern0"]["sig"][k], f"{plan}: {k} differs in Wada")
            self.assertNotEqual(d["wada"]["sig"]["furniture"], d["modern0"]["sig"]["furniture"], "the Wada pieces are different pieces")
            for k in ("struct", "furniture", "layout"):
                self.assertEqual(d["modern1"]["sig"][k], d["modern0"]["sig"][k])
                self.assertEqual(d["modern2"]["sig"][k], d["modern0"]["sig"][k])
        c0, c1 = self.data["court_modern"]["sig"], self.data["court_wada"]["sig"]
        self.assertEqual(c1["layout"], c0["layout"], "the courtyard plan keeps its furniture footprints in Wada")
        self.assertEqual(c1["struct"], c0["struct"], "a real courtyard in Wada does not move a wall")

    def test_furniture_stays_inside_the_house(self):
        for plan, d in self.data["plans"].items():
            for s in ("modern0", "trad", "wada"):
                self.assertGreater(d[s]["fit"]["n"], 3)
                self.assertEqual(d[s]["fit"]["outside"], 0, f"{plan} {s}: furniture outside the plan")

    def test_traditional_indian_really_changes_the_house(self):
        for plan, d in self.data["plans"].items():
            self.assertEqual(d["modern0"]["tile"], 0, "Modern has no tile roof")
            self.assertGreater(d["trad"]["tile"], 0, f"{plan}: Traditional Indian has tiled roofs")
            self.assertEqual(d["trad"]["style"], TRAD)
            self.assertEqual(d["modern0"]["style"], MODERN)
            diff = np.abs(d["trad"]["shot"] - d["modern0"]["shot"]).mean()
            self.assertGreater(diff, 2.5, f"{plan}: the two styles look alike (mean abs diff {diff:.1f})")
            self.assertNotEqual(d["trad"]["mats"], d["modern0"]["mats"])

    def test_wada_really_changes_the_house(self):
        for plan, d in self.data["plans"].items():
            self.assertEqual(d["wada"]["style"], WADA)
            self.assertGreater(d["wada"]["tile"], 0, f"{plan}: Wada has tiled roofs")
            self.assertNotEqual(d["wada"]["mats"], d["trad"]["mats"], f"{plan}: Wada is not Traditional Indian")
            for other in ("modern0", "trad"):
                diff = np.abs(d["wada"]["shot"] - d[other]["shot"]).mean()
                self.assertGreater(diff, 2.5, f"{plan}: Wada looks like {other} (mean abs diff {diff:.1f})")
        self.assertEqual(self.data["court_note"], 0, "a plan with a courtyard room gets no 'no courtyard' note")
        self.assertGreater(self.data["court_wada"]["meshes"], self.data["court_modern"]["meshes"], "Wada adds carved structure around the court")

    def test_repeated_switching_leaves_no_mixed_materials(self):
        for plan, d in self.data["plans"].items():
            m0, m1 = d["modern0"], d["modern1"]
            self.assertEqual(m1["mats"], m0["mats"], f"{plan}: materials left over from the other style")
            self.assertEqual(m1["meshes"], m0["meshes"])
            self.assertEqual(m1["tile"], 0)
            self.assertEqual(d["modern2"]["mats"], m0["mats"], f"{plan}: Wada left materials behind")
            self.assertEqual(d["modern2"]["tile"], 0)
            self.assertLess(np.abs(m1["shot"] - m0["shot"]).mean(), 0.5, f"{plan}: Modern looks different after switching")
            t0, t1 = d["trad"], d["trad1"]
            self.assertEqual(t1["mats"], t0["mats"])
            self.assertEqual(t1["meshes"], t0["meshes"])
            self.assertLess(np.abs(t1["shot"] - t0["shot"]).mean(), 0.5)

    def test_glb_matches_the_viewer(self):
        for plan, d in self.data["plans"].items():
            jm = glb_tools.load(os.path.join(self.dir, f"{plan}_modern.glb"))
            jt = glb_tools.load(os.path.join(self.dir, f"{plan}_trad.glb"))
            names = lambda j: {m.get("name", "") for m in j.get("materials", [])}
            self.assertNotIn("roof_tile_clay", names(jm), f"{plan}: Modern .glb has no tile material")
            self.assertIn("roof_tile_clay", names(jt), f"{plan}: Traditional .glb carries the tile material")
            jw = glb_tools.load(os.path.join(self.dir, f"{plan}_wada.glb"))
            self.assertIn("roof_tile_clay", names(jw), f"{plan}: Wada .glb carries the tile material")
            for j, want in ((jm, MODERN), (jt, TRAD), (jw, WADA)):
                extras = [n.get("extras", {}).get("architecturalStyle") for n in j["nodes"] if n.get("extras")]
                self.assertIn(want, extras, f"{plan}: the style travels in the file")
            self.assertGreater(len(jt.get("textures", [])), 5)
            self.assertLess(os.path.getsize(os.path.join(self.dir, f"{plan}_trad.glb")), 60 * 1024 * 1024)
            lo_m, hi_m = glb_tools.bbox(jm)
            lo_t, hi_t = glb_tools.bbox(jt)
            self.assertTrue(np.all(lo_t <= lo_m + 0.05), "the Traditional model contains the Modern footprint")
            top = 10.0 * d["floors"]
            self.assertGreater(hi_t[1], top + 2.0, "the pitched roof rises clearly above the top slab")

    def test_no_console_errors(self):
        self.assertEqual([e for e in self.data["errors"] if "GL Driver" not in e and "GPU stall" not in e], [])


if __name__ == "__main__":
    unittest.main()
