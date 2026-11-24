"""2D plan, 3D model and furniture all show the same validated circulation (real browser, dev harness ``frontend-react/dev/twin.html``).

For stored generated plans (G+1 with a terrace, G+2, a wide plot) it checks that

* the 2D plan draws exactly the doors of the plan, floor by floor, between the same rooms;
* the 3D model builds a leaf for every door into a private room (none missing, none invented; open-plan openings are cased);
* no furniture stands in a doorway or in the walking strip of a corridor, on any floor (a ray is dropped over a grid on each door's
  clearance zone and on each corridor's centre line; control zones over a bedroom / living room prove the probe sees furniture);
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
PLANS = ["cf_g1_terrace", "cf_g2", "cf_g1_wide"]

PROBE = """(zones) => {
  const T = window.__twin, THREE = T.THREE, m = T.model, H = m.wallH;
  const meshes = []; for (const g of m.furniture) { g.updateWorldMatrix(true, true); g.traverse((o) => { if (o.isMesh) meshes.push(o) }) }
  const rc = new THREE.Raycaster(); const down = new THREE.Vector3(0, -1, 0); const out = [];
  for (const z of zones) {
    const base = z.floor * H; let worst = 0;
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
      const x = z.x0 + (z.x1 - z.x0) * i / 6, zz = z.z0 + (z.z1 - z.z0) * j / 6;
      rc.set(new THREE.Vector3(x, base + H - 0.4, zz), down);
      const hit = rc.intersectObjects(meshes, false).find((h) => h.point.y > base - 0.01 && h.point.y < base + H - 0.3);
      if (hit) worst = Math.max(worst, hit.point.y - base);
    }
    out.push({ label: z.label, kind: z.kind, floor: z.floor, height: worst });
  }
  return { zones: out, doors3d: m.doors.length, meshes: meshes.length }
}"""


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


def zones_of(plan):
    """Clearance zone of every door (2 ft each side of the wall, the opening's width) and the centre strip of every corridor."""
    zones = []
    for fi, fl in enumerate(plan["floors"]):
        lay = fl["layout"]
        for d in lay["openings"]["doors"]:
            if d.get("connects_to") is None:
                continue
            x1, y1, x2, y2, pad, depth = d["x1"], d["y1"], d["x2"], d["y2"], 0.25, 2.0
            label = f"{fl['floor']}: {d['room']} -> {d['connects_to']}"
            if abs(y1 - y2) < 1e-6:
                zones.append(dict(kind="door", label=label, floor=fi, x0=min(x1, x2) + pad, x1=max(x1, x2) - pad, z0=y1 - depth, z1=y1 + depth))
            else:
                zones.append(dict(kind="door", label=label, floor=fi, x0=x1 - depth, x1=x1 + depth, z0=min(y1, y2) + pad, z1=max(y1, y2) - pad))
        for r in lay["rooms"]:
            if r["room_type"] == "passage":
                if r["width"] >= r["length"]:
                    zones.append(dict(kind="corridor", label=f"{fl['floor']}: {r['id']}", floor=fi, x0=r["x"] + 0.3, x1=r["x2"] - 0.3,
                                      z0=r["y"] + r["length"] / 2 - 1.0, z1=r["y"] + r["length"] / 2 + 1.0))
                else:
                    zones.append(dict(kind="corridor", label=f"{fl['floor']}: {r['id']}", floor=fi, x0=r["x"] + r["width"] / 2 - 1.0,
                                      x1=r["x"] + r["width"] / 2 + 1.0, z0=r["y"] + 0.3, z1=r["y2"] - 0.3))
            elif r["room_type"] in ("master_bedroom", "living_room"):
                zones.append(dict(kind="control", label=f"{fl['floor']}: {r['id']}", floor=fi, x0=r["x"] + 0.5, x1=r["x2"] - 0.5, z0=r["y"] + 0.5, z1=r["y2"] - 0.5))
    return zones


class CirculationRender(unittest.TestCase):
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
                plan = json.loads((FIX / f"{name}.json").read_text())
                r = {"doors2d": []}
                for fi in range(len(plan["floors"])):
                    pg.goto(f"http://127.0.0.1:{PORT}/dev/twin.html?plan={name}&view=2d&floor={fi}")
                    pg.wait_for_selector("svg")
                    r["doors2d"].append(pg.evaluate("""() => [...document.querySelectorAll('[data-testid=door]')].map(g => [g.dataset.from, g.dataset.to])"""))
                pg.goto(f"http://127.0.0.1:{PORT}/dev/twin.html?plan={name}&h=600")
                pg.wait_for_function("window.__twin && window.__twin.model", timeout=240000)
                r["probe"] = pg.evaluate(PROBE, zones_of(plan))
                out["plans"][name] = r
            b.close()
        return out

    def plan(self, name):
        return json.loads((FIX / f"{name}.json").read_text())

    def test_2d_draws_exactly_the_doors_of_the_plan_on_every_floor(self):
        for name in PLANS:
            plan = self.plan(name)
            for fi, fl in enumerate(plan["floors"]):
                want = sorted((d["room"], d["connects_to"] or "") for d in fl["layout"]["openings"]["doors"])
                got = sorted(tuple(x) for x in self.data["plans"][name]["doors2d"][fi])
                self.assertEqual(got, want, f"{name} {fl['floor']}")

    def test_3d_builds_a_door_leaf_for_every_door_that_has_one(self):
        """A door into a private room (or the entrance) always gets a leaf; only arches and the open-plan openings between two
        common spaces (living / dining / lounge / passage / stair / terrace) are cased openings without one."""
        open_plan = {"living_room", "dining", "family_lounge", "passage", "staircase", "open_terrace"}
        for name in PLANS:
            plan = self.plan(name)
            must = total = 0
            for fl in plan["floors"]:
                types = {r["id"]: r["room_type"] for r in fl["layout"]["rooms"]}
                for d in fl["layout"]["openings"]["doors"]:
                    total += 1
                    other = types.get(d["connects_to"]) if d.get("connects_to") else None
                    if d.get("door_type") == "arch":
                        continue
                    if other is None or not (types[d["room"]] in open_plan and other in open_plan):
                        must += 1
            got = self.data["plans"][name]["probe"]["doors3d"]
            self.assertGreaterEqual(got, must, f"{name}: a door of the plan has no leaf in 3D")
            self.assertLessEqual(got, total, f"{name}: 3D invents doors")

    def test_furniture_never_blocks_a_doorway_or_a_corridor(self):
        checked = 0
        for name in PLANS:
            probe = self.data["plans"][name]["probe"]
            for z in probe["zones"]:
                if z["kind"] == "control":
                    continue
                checked += 1
                self.assertLess(z["height"], 0.6, f"{name}: furniture blocks {z['kind']} {z['label']} ({z['height']:.1f} ft high)")
        self.assertGreater(checked, 40)

    def test_the_probe_really_sees_furniture(self):
        for name in PLANS:
            controls = [z for z in self.data["plans"][name]["probe"]["zones"] if z["kind"] == "control"]
            self.assertTrue(controls)
            self.assertTrue(all(z["height"] > 1.5 for z in controls), f"{name}: the probe missed furniture it should see: {controls}")

    def test_no_console_errors(self):
        self.assertEqual([e for e in self.data["errors"] if "GL Driver" not in e and "GPU stall" not in e], [])


if __name__ == "__main__":
    unittest.main()
