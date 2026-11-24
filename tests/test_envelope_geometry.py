"""Pure geometry of the roof / terrace envelope helpers (``frontend-react/src/components/twinEnvelope.ts``): overhang strips and corners are disjoint, stay off the
roofed rooms, the fascia never lies inside a slab or over the building, parapets sit on the roof edge and never in front of the head-room door.  The audit is
``frontend-react/dev/check_envelope.ts``, bundled with esbuild and run with node.  Skipped when node / esbuild are missing."""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

FRONT = Path(__file__).resolve().parents[1] / "frontend-react"


class EnvelopeGeometry(unittest.TestCase):
    def test_overhang_fascia_parapet_and_door_geometry(self):
        esbuild = FRONT / "node_modules" / ".bin" / "esbuild"
        node = shutil.which("node")
        if not esbuild.exists() or not node:
            self.skipTest("esbuild / node unavailable")
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "check_envelope.cjs"
            subprocess.run([str(esbuild), "dev/check_envelope.ts", "--bundle", "--platform=node", "--format=cjs", f"--outfile={out}", "--log-level=error"],
                           cwd=FRONT, check=True, timeout=120)
            res = subprocess.run([node, str(out)], capture_output=True, text=True, timeout=120, check=True)
        bad = json.loads(res.stdout.strip().splitlines()[-1])
        self.assertEqual(bad, [], "\n".join(bad[:10]))


if __name__ == "__main__":
    unittest.main()
