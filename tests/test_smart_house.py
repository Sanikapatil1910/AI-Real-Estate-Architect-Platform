"""Smart-house data (lights, fans, wall switches, regulator) for the Unity / Meta Quest demo.

* audit: every stored plan fixture gets a light under its ceiling, fans only where they fit (size, height, clear of walls), a switch and a regulator that are on the room-side
  wall face, 4 ft above the floor, clear of door and window openings and within reach of a door;
* sample data of the Unity package is what the generator writes today (it is the test data of the C# suite);
* in a real browser: the .smarthouse.json written by the viewer's button is in the SAME frame as the .glb the viewer exports (floor heights, ceilings, and the room-side wall
  faces the switches are mounted on really exist in the exported geometry), for all three styles;
* the generator, the plans and the 3D build are untouched by it (this file only reads them).

The browser part is skipped when playwright / node_modules / a browser are missing."""
import json
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FE = ROOT / "frontend-react"
FIX = FE / "dev" / "fixtures"
UNITY = ROOT / "unity-smart-house" / "Packages" / "com.realestate.smarthouse" / "Tests" / "Editor" / "Data"
PORT = 5173
STYLES = ["modern_minimalistic", "traditional_indian", "maharashtrian_wada"]


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


def _esbuild(entry, out):
    exe = FE / "node_modules" / ".bin" / "esbuild"
    if not exe.exists() or not shutil.which("node"):
        raise unittest.SkipTest("esbuild/node not available (run npm install in frontend-react)")
    subprocess.run([str(exe), str(entry), "--bundle", "--platform=node", "--format=cjs", f"--outfile={out}", "--log-level=error", "--alias:@=" + str(FE / "src")],
                   check=True, cwd=FE)


class SmartHouseData(unittest.TestCase):
    tmp = None

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.check = cls.tmp / "check.cjs"
        cls.emit = cls.tmp / "emit.cjs"
        _esbuild(FE / "dev" / "check_smart_house.ts", cls.check)
        _esbuild(FE / "dev" / "emit_smart_house.ts", cls.emit)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def emit_for(self, name):
        out = subprocess.run(["node", str(self.emit), str(FIX / f"{name}.json")], check=True, capture_output=True, text=True).stdout
        return json.loads(out)

    def test_audit_over_every_plan_fixture(self):
        files = sorted(str(p) for p in FIX.glob("*.json"))
        self.assertGreaterEqual(len(files), 10)
        out = subprocess.run(["node", str(self.check), *files], check=True, capture_output=True, text=True).stdout
        res = json.loads(out)
        self.assertEqual(res["bad"], [], "\n".join(res["bad"][:20]))
        st = res["stats"]
        self.assertGreaterEqual(st["plans"], 10)
        self.assertGreater(st["fans"], 0)
        self.assertEqual(st["switches"] + st["noSwitch"], st["rooms"])
        self.assertEqual(st["regulators"], st["fans"], "every fan has its regulator")

    def test_schema_and_unique_room_keys(self):
        for name in ("sc_g2", "sc_a_f50", "wada_court"):
            d = self.emit_for(name)
            self.assertEqual(d["schema"], "realestate.smart-house/1")
            self.assertEqual(d["units"], "feet")
            keys = [f"{r['floor']}:{r['id']}" for r in d["rooms"]]
            self.assertEqual(len(keys), len(set(keys)), name)
            for r in d["rooms"]:
                for k in ("id", "name", "type", "floor", "rect", "floor_y", "ceiling_y", "light", "fan", "switch", "regulator"):
                    self.assertIn(k, r, f"{name} {r['id']}")
                if r["switch"]:
                    n = r["switch"]["normal"]
                    self.assertAlmostEqual(sum(c * c for c in n), 1.0, places=6)
                    self.assertAlmostEqual(r["switch"]["pos"][1] - r["floor_y"], 4.0, places=3)

    def test_generation_is_deterministic_and_leaves_the_plan_alone(self):
        for name in ("sc_g2", "cf_g1_terrace"):
            a, b = self.emit_for(name), self.emit_for(name)
            self.assertEqual(a, b)
        before = (FIX / "sc_g2.json").read_bytes()
        self.emit_for("sc_g2")
        self.assertEqual(before, (FIX / "sc_g2.json").read_bytes())

    def test_unity_sample_data_is_what_the_generator_writes(self):
        for name in ("sc_g2", "sc_a_f50"):
            stored = json.loads((UNITY / f"sample_{name}.smarthouse.json").read_text())
            self.assertEqual(stored, self.emit_for(name), f"regenerate the Unity sample: node emit.cjs dev/fixtures/{name}.json > {name}")


# ---- the sidecar against the real exported .glb ---------------------------------------------------------------------------------------------
def _read_glb(path):
    b = Path(path).read_bytes()
    clen, _ = struct.unpack("<II", b[12:20])
    j = json.loads(b[20:20 + clen])
    off = 20 + clen
    blen, _ = struct.unpack("<II", b[off:off + 8])
    return j, b[off + 8:off + 8 + blen]


def _world_vertices(j, binary):
    import numpy as np
    nodes = j["nodes"]

    def mat(n):
        if "matrix" in n:
            return np.array(n["matrix"]).reshape(4, 4).T
        t = np.array(n.get("translation", [0, 0, 0]))
        x, y, z, w = n.get("rotation", [0, 0, 0, 1])
        s = np.array(n.get("scale", [1, 1, 1]))
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        M = np.eye(4)
        M[:3, :3] = R * s
        M[:3, 3] = t
        return M

    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    out = []
    for i, n in enumerate(nodes):
        if "mesh" not in n:
            continue
        k, M = i, mat(n)
        while k in parent:
            k = parent[k]
            M = mat(nodes[k]) @ M
        for pr in j["meshes"][n["mesh"]]["primitives"]:
            a = j["accessors"][pr["attributes"]["POSITION"]]
            if a["componentType"] != 5126 or a["type"] != "VEC3":
                continue
            bv = j["bufferViews"][a["bufferView"]]
            stride = bv.get("byteStride", 12)
            start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
            if stride == 12:
                v = np.frombuffer(binary, dtype="<f4", count=a["count"] * 3, offset=start).reshape(-1, 3)
            else:
                v = np.array([struct.unpack_from("<3f", binary, start + q * stride) for q in range(a["count"])])
            v = v.astype(float)
            if (v.max(0) - v.min(0)).max() > 100:         # the ground plane
                continue
            out.append((M[:3, :3] @ v.T).T + M[:3, 3])
    return np.vstack(out)


class SmartHouseMatchesGlb(unittest.TestCase):
    proc = None
    data = {}
    PLANS = ["sc_g2", "sc_a_f50"]

    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright  # noqa: F401
            import numpy  # noqa: F401
        except Exception as exc:
            raise unittest.SkipTest(f"playwright/numpy unavailable: {exc}")
        if not (FE / "node_modules").exists():
            raise unittest.SkipTest("frontend-react/node_modules missing (run npm install)")
        if not _up(PORT):
            npx = shutil.which("npx")
            if not npx:
                raise unittest.SkipTest("npx not found")
            cls.proc = subprocess.Popen([npx, "vite", "--port", str(PORT), "--host", "127.0.0.1"], cwd=FE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        if not _wait(f"http://127.0.0.1:{PORT}/dev/twin.html"):
            cls.tearDownClass()
            raise unittest.SkipTest("the dev server did not start")
        cls.tmp = Path(tempfile.mkdtemp())
        cls.data = cls._run()

    @classmethod
    def tearDownClass(cls):
        if cls.proc:
            try:
                os.killpg(cls.proc.pid, 15)
            except Exception:
                pass
            cls.proc = None
        if getattr(cls, "tmp", None):
            shutil.rmtree(cls.tmp, ignore_errors=True)

    @classmethod
    def _run(cls):
        from playwright.sync_api import sync_playwright
        out = {"errors": [], "files": {}}
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
            pg = b.new_page(viewport={"width": 1300, "height": 900}, accept_downloads=True)
            pg.set_default_timeout(240000)
            pg.on("pageerror", lambda e: out["errors"].append(str(e)))
            for name in cls.PLANS:
                for st in STYLES:
                    pg.goto(f"http://127.0.0.1:{PORT}/dev/twin.html?plan={name}&style={st}&h=500")
                    pg.wait_for_function("window.__twin && window.__twin.model")
                    with pg.expect_download() as d1:
                        pg.get_by_text("Download 3D model (.glb)").click()
                    glb = cls.tmp / f"{name}_{st}.glb"
                    d1.value.save_as(str(glb))
                    with pg.expect_download() as d2:
                        pg.get_by_text("Smart-house data (.json)").click()
                    js = cls.tmp / f"{name}_{st}.json"
                    d2.value.save_as(str(js))
                    out["files"][(name, st)] = (glb, js, d2.value.suggested_filename)
            b.close()
        return out

    def test_no_page_errors(self):
        self.assertEqual(self.data["errors"], [])

    def test_button_names_the_file_after_the_plan(self):
        for (name, st), (glb, js, fname) in self.data["files"].items():
            self.assertRegex(fname, r"^house-\d+\.smarthouse\.json$")

    def test_floors_and_ceilings_exist_in_the_glb_at_the_heights_in_the_file(self):
        import numpy as np
        for (name, st), (glb, js, _) in self.data["files"].items():
            sh = json.loads(js.read_text())
            v = _world_vertices(*_read_glb(glb))
            ys = np.unique(np.round(v[:, 1], 2))
            for f in sh["floors"]:
                self.assertTrue(np.any(np.abs(ys - f["floor_y"]) < 0.03), f"{name}/{st}: no geometry at floor level {f['floor_y']}")
                self.assertTrue(np.any(np.abs(ys - f["ceiling_y"]) < 0.03), f"{name}/{st}: no geometry at ceiling level {f['ceiling_y']}")

    def test_the_footprint_is_inside_the_glb_and_the_frame_is_not_mirrored(self):
        import numpy as np
        for (name, st), (glb, js, _) in self.data["files"].items():
            sh = json.loads(js.read_text())
            v = _world_vertices(*_read_glb(glb))
            fp = sh["footprint"]
            lo, hi = v.min(0), v.max(0)
            self.assertLessEqual(lo[0], fp["x0"] + 0.5, f"{name}/{st}")
            self.assertGreaterEqual(hi[0], fp["x1"] - 0.5, f"{name}/{st}")
            self.assertLessEqual(lo[2], fp["z0"] + 0.5, f"{name}/{st}")
            self.assertGreaterEqual(hi[2], fp["z1"] - 0.5, f"{name}/{st}")
            # walls sit at the footprint edges: vertices exist right at the exterior x and z limits (a mirrored z would put them elsewhere)
            near = lambda a, t: bool(np.any(np.abs(a - t) < 1.2))
            self.assertTrue(near(v[:, 0], fp["x0"]) and near(v[:, 0], fp["x1"]) and near(v[:, 2], fp["z0"]) and near(v[:, 2], fp["z1"]), f"{name}/{st}")

    def test_every_switch_plate_is_on_a_real_wall_face_in_the_glb(self):
        import numpy as np
        bad = []
        n = 0
        for (name, st), (glb, js, _) in self.data["files"].items():
            sh = json.loads(js.read_text())
            v = _world_vertices(*_read_glb(glb))
            for r in sh["rooms"]:
                s = r["switch"]
                if not s:
                    continue
                n += 1
                nx, nz = s["normal"][0], s["normal"][2]
                t = s["wall_thickness_ft"]
                axis = 0 if abs(nx) > 0.5 else 2                      # the wall's normal axis
                sign = nx if axis == 0 else nz
                face = s["pos"][axis] + sign * t / 2                # room-side face of the wall
                along = 2 if axis == 0 else 0
                sel = v[(np.abs(v[:, axis] - face) < 0.03) & (v[:, 1] > r["floor_y"] - 0.05) & (v[:, 1] < r["ceiling_y"] + 0.05)]
                p = s["pos"][along]
                if len(sel) == 0 or sel[:, along].min() > p + 0.05 or sel[:, along].max() < p - 0.05:
                    bad.append(f"{name}/{st} {r['floor']}:{r['id']} switch wall face at {'xz'[axis // 2]}={face:.3f} not found around {p:.2f}")
        self.assertGreater(n, 40)
        self.assertEqual(bad, [], "\n".join(bad[:15]))


if __name__ == "__main__":
    unittest.main()
