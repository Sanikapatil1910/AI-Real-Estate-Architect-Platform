"""Stair geometry audit (every stair shape): continuous climb, no railing across the walking path, rails only on exposed edges, a guard round the
upstairs opening on the arrival side.  The audit is `frontend-react/dev/check_stairs.ts` (pure geometry, no browser); it is bundled with esbuild and run
with node, and prints a JSON list of violations that must be empty.  Skipped when node / esbuild are missing."""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / "frontend-react"


class StairGeometry(unittest.TestCase):
    def test_no_rail_crosses_the_walking_path_and_every_stair_is_continuous(self):
        esbuild = FRONT / "node_modules" / ".bin" / "esbuild"
        node = shutil.which("node")
        if not esbuild.exists() or not node:
            self.skipTest("esbuild / node unavailable")
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "check_stairs.cjs"
            subprocess.run([str(esbuild), "dev/check_stairs.ts", "--bundle", "--platform=node", "--format=cjs", f"--outfile={out}", "--log-level=error"],
                           cwd=FRONT, check=True, timeout=120)
            res = subprocess.run([node, str(out)], capture_output=True, text=True, timeout=120, check=True)
        violations = json.loads(res.stdout.strip().splitlines()[-1])
        self.assertEqual(violations, [], "\n".join(map(str, violations[:10])))


if __name__ == "__main__":
    unittest.main()
