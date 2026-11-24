"""Smart House VR in the browser (WebXR, no Unity).

Three layers, kept apart on purpose:

* VrUnitChecks (always run, node only): walking grid on synthetic geometry, Smart House logic (fans, lights, automatic lighting, energy, voice parser, panel layout, JSON parsing
  over the stored plan fixtures), WebXR availability / fallback decisions against a FAKE navigator.xr.
* VrBrowserE2E (opt-in: VR_E2E=1; ~8 min per house in headless software-GL Chromium): the real backend + the real website pages: sign in, saved house -> "VR walk-through" -> Enter VR page,
  the house built from the plan, exported to .glb, loaded back, merged, collision grid, desktop walking, panel / wall plates / typed commands, fans, automatic lighting, energy panel, the
  voice-unavailable path.  Also, clearly named MOCK: a fake navigator.xr / XRSession with injected controller input.
  None of it runs on a Meta Quest; WebXR itself is mocked, so these tests prove OUR code paths, not that a headset accepts the session.
  VR_E2E_FIXTURES=g1_0,g2_0 selects houses (default g1_0); VR_E2E_OUT=<dir> keeps the screenshots.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FE = ROOT / "frontend-react"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait(url, secs=120):
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
    subprocess.run([str(exe), str(entry), "--bundle", "--platform=node", "--format=cjs", f"--outfile={out}", "--log-level=error", "--alias:@=" + str(FE / "src")], check=True, cwd=FE)


class VrUnitChecks(unittest.TestCase):
    tmp = None

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def run_check(self, name, minimum):
        out = self.tmp / f"{name}.cjs"
        _esbuild(FE / "dev" / f"{name}.ts", out)
        p = subprocess.run(["node", str(out)], capture_output=True, text=True, timeout=300, env=dict(os.environ, VR_FIXTURES=str(FE / "dev" / "fixtures")))
        res = json.loads(p.stdout.strip().splitlines()[-1])
        self.assertEqual(res["failed"], [], json.dumps(res["failed"], indent=1))
        self.assertEqual(p.returncode, 0)
        self.assertGreaterEqual(res["passed"], minimum)
        self.assertEqual(res["passed"], res["total"])

    def test_smart_house_core_logic(self):
        self.run_check("check_smart_core", 44)

    def test_hands_free_voice_lifecycle(self):
        self.run_check("check_voice_continuous", 40)

    def test_customization_document_and_skin_geometry(self):
        self.run_check("check_custom", 20)

    def test_qr_share_and_scan_logic(self):
        self.run_check("check_qr", 20)

    def test_walking_grid_on_synthetic_geometry(self):
        self.run_check("check_nav", 13)

    def test_stair_walk_surfaces_for_every_stair_shape(self):
        self.run_check("check_stairwalk", 80)

    def test_teleport_arc_on_synthetic_geometry(self):
        self.run_check("check_teleport", 9)

    def test_seat_height_stand_spot_and_nearest_seat(self):
        self.run_check("check_seats", 7)

    def test_webxr_availability_and_voice_fallbacks(self):
        self.run_check("check_xr", 6)

    def test_walkability_clearance_door_repair_and_strict_audit(self):
        self.run_check("check_access", 11)


@unittest.skipUnless(os.environ.get("VR_E2E") == "1", "browser end-to-end is opt-in: VR_E2E=1 (slow, needs playwright + chromium + node_modules)")
class VrBrowserE2E(unittest.TestCase):
    procs = []
    base = None

    @classmethod
    def setUpClass(cls):
        if not shutil.which("node") or not (FE / "node_modules").exists():
            raise unittest.SkipTest("node / node_modules missing")
        cls.tmp = Path(tempfile.mkdtemp())
        bport, vport = _free_port(), _free_port()
        env = dict(os.environ, DATABASE_URL=f"sqlite:///{cls.tmp / 'vr.db'}")
        code = f"import sys; sys.path.insert(0, {str(ROOT)!r}); import uvicorn; from backend.main import app; uvicorn.run(app, host='127.0.0.1', port={bport}, log_level='warning')"
        cls.procs.append(subprocess.Popen([sys.executable, "-c", code], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        cls.procs.append(subprocess.Popen([str(FE / "node_modules" / ".bin" / "vite"), "--port", str(vport), "--host", "127.0.0.1", "--strictPort"], cwd=FE,
                                          env=dict(os.environ, API_TARGET=f"http://127.0.0.1:{bport}"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        if not (_wait(f"http://127.0.0.1:{bport}/health") and _wait(f"http://127.0.0.1:{vport}/")):
            raise RuntimeError("backend / vite did not start")
        cls.base = f"http://127.0.0.1:{vport}"

    @classmethod
    def tearDownClass(cls):
        for p in cls.procs:
            p.terminate()
        for p in cls.procs:
            try:
                p.wait(10)
            except Exception:
                p.kill()
        shutil.rmtree(getattr(cls, "tmp", "."), ignore_errors=True)

    def test_browser_end_to_end(self):
        fixtures = os.environ.get("VR_E2E_FIXTURES", "g1_0")
        out = os.environ.get("VR_E2E_OUT") or str(self.tmp / "shots")
        node_path = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip()
        p = subprocess.run(["node", str(FE / "dev" / "e2e_vr.cjs"), self.base, fixtures, out], capture_output=True, text=True, timeout=3000, env=dict(os.environ, NODE_PATH=node_path))
        if p.returncode != 0 and "Cannot find module 'playwright'" in p.stderr:
            self.skipTest("playwright is not installed")
        self.assertEqual(p.returncode, 0, p.stderr[-2000:])
        res = json.loads(p.stdout.strip().splitlines()[-1])
        bad = [f"[{b}] {t['name']}: {t['detail']}" for b in ("executed", "simulated") for t in res[b] if not t["ok"]]
        self.assertEqual(bad, [], "\n".join(bad))
        self.assertGreaterEqual(len(res["executed"]), 20)
        self.assertGreaterEqual(len(res["simulated"]), 5)
        Path(os.environ.get("VR_E2E_REPORT", self.tmp / "report.json")).write_text(json.dumps(res, indent=1))

    def _run_node(self, script, *args):
        node_path = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip()
        p = subprocess.run(["node", str(FE / "dev" / script), *args], capture_output=True, text=True, timeout=3000, env=dict(os.environ, NODE_PATH=node_path))
        if p.returncode != 0 and "Cannot find module 'playwright'" in p.stderr:
            self.skipTest("playwright is not installed")
        self.assertEqual(p.returncode, 0, p.stderr[-2000:])
        res = json.loads(p.stdout.strip().splitlines()[-1])
        bad = [f"[{b}] {t['name']}: {t['detail']}" for b in ("executed", "simulated") for t in res.get(b, []) if not t["ok"]]
        self.assertEqual(bad, [], "\n".join(bad))
        return res

    def test_live_customization_in_browser(self):
        out = os.environ.get("VR_E2E_OUT") or str(self.tmp / "shots")
        res = self._run_node("e2e_custom.cjs", self.base, os.environ.get("VR_E2E_FIXTURES", "g1_0"), out)
        self.assertGreaterEqual(len(res["executed"]), 15)
        self.assertGreaterEqual(len(res["simulated"]), 6)

    def test_human_scale_dimensions(self):
        out = os.environ.get("VR_E2E_OUT") or str(self.tmp / "shots")
        res = self._run_node("e2e_scale.cjs", self.base, os.environ.get("VR_E2E_FIXTURES", "g1_0"), out)
        self.assertGreaterEqual(len(res["executed"]), 10)

    def test_qr_share_and_scan_in_browser(self):
        if not shutil.which("ffmpeg"):
            self.skipTest("ffmpeg is needed to make the fake-camera test video")
        try:
            import qrcode  # noqa: F401  (only used to make the test images that the fake camera plays)
        except ImportError:
            self.skipTest("python 'qrcode' package is needed to make the test images (pip install qrcode)")
        out = os.environ.get("VR_E2E_OUT") or str(self.tmp / "shots")
        res = self._run_node("e2e_qr.cjs", self.base, out)
        self.assertGreaterEqual(len(res["executed"]), 25)
        self.assertGreaterEqual(len(res["simulated"]), 3)


if __name__ == "__main__":
    unittest.main()
