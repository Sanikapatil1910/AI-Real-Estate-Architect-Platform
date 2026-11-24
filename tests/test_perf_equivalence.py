"""The generator's speed-ups must not change what it builds.

* the search is replayed with fixed seeds and every structure / floor it realises is hashed: the hashes equal the ones recorded
  from the code *before* the optimisations (tests/perf_golden_expected.json);
* each cache / memo is checked against the plain computation it replaces, including after the rules change.
"""
import json
import random
import unittest
from pathlib import Path

HERE = Path(__file__).parent


class GoldenEquivalence(unittest.TestCase):
    def test_search_results_identical_to_recorded_baseline(self):
        from tests.perf_golden import fingerprint
        got = fingerprint()
        want = json.loads((HERE / "perf_golden_expected.json").read_text())
        self.assertEqual(got, want)


class CachesMatchPlainComputation(unittest.TestCase):
    def test_stack_pair_table_equals_the_stackable_sets(self):
        from backend.planner.architect.layout import STACKABLE, _STACK2
        types = sorted({t for fs in STACKABLE for t in fs} | {"living_room", "kitchen", "bedroom", "dining"})
        for a in types:
            for b in types:
                self.assertEqual((a, b) in _STACK2, frozenset({a, b}) in STACKABLE, (a, b))

    def test_cell_bounds_cache_follows_rule_changes(self):
        from backend.planner.architect import rules, sizing
        rules.set_strict(True)
        rules.set_compact(1.0)
        keys = [(("bedroom",), 11.0), (("living_room",), 13.0), (("kitchen", "utility"), 9.0), (("bathroom",), 6.0)]
        for compact in (1.0, 0.85, 1.0):
            rules.set_compact(compact)
            for types, d in keys:
                self.assertEqual(sizing.cell_bounds(types, d), sizing.cell_bounds.__wrapped__(types, d), (compact, types, d))
        for aspect in (1.25, 1.6, 1.25):
            rules.set_aspect(aspect)
            for types, d in keys:
                self.assertEqual(sizing.cell_bounds(types, d), sizing.cell_bounds.__wrapped__(types, d), (aspect, types, d))
        rules.set_strict(True)
        rules.set_compact(1.0)

    def test_cell_plan_memo_tracks_changes_to_the_cell(self):
        from backend.planner.architect.layout import Cell
        from backend.planner.architect.program import RoomSpec
        a = RoomSpec(id="b1", type="bedroom", name="Bedroom", floor=0, target=120.0)
        b = RoomSpec(id="t1", type="bathroom", name="Bath", floor=0, target=40.0)
        c = Cell(specs=[a, b])
        p1 = c.plan()
        self.assertIs(c.plan(), p1, "memoised")
        self.assertEqual(p1.types, ("bedroom", "bathroom"))
        c.specs[:] = [b, a]                       # what _orient_pair does
        self.assertEqual(c.plan().types, ("bathroom", "bedroom"))
        c.fixed_w = 7.0
        self.assertEqual(c.plan().fixed_w, 7.0)
        c.min_w = 9.0
        self.assertEqual(c.plan().min_w, 9.0)
        c.specs.pop()
        self.assertEqual(len(c.plan().types), 1)

    def test_band_specs_memo_equals_fresh_computation(self):
        from backend.planner.architect import layout
        from backend.planner.architect.engine import _gen_floor
        from backend.planner.architect import service
        from backend.planner.architect.feasibility import _site_and_program, available_box
        from backend.planner.architect.rules import GRID, set_strict, set_compact
        from backend.planner.architect.site import snap_down
        from tests.bench_generation import CASES
        import time
        p = dict(CASES["medium"])
        p["vastu_mode"] = service._normalise_vastu(p.get("vastu_mode"))
        set_strict(False)
        set_compact(1.0)
        site, program = _site_and_program(p)
        box = available_box(site)
        F, D = snap_down(box["frontage"], GRID), snap_down(box["depth"], GRID)
        seen = []
        orig = layout._band_specs

        def spy(st):
            out = orig(st)
            seen.append((st, out))
            return out
        layout._band_specs = spy
        try:
            rng = random.Random(3)
            random.seed(3)
            flr = program.floors[0]
            _gen_floor(rng, flr, 0, len(program.floors), F, D, "rows", None, 40, {s.id: s.target for s in flr.all_specs()}, time.time() + 60)
        finally:
            layout._band_specs = orig
        self.assertTrue(seen, "the search asked for band specs")
        for st, memo in seen[:25]:
            st._bs = None
            fresh = orig(st)
            self.assertEqual(repr(fresh), repr(memo))
            self.assertIs(orig(st), fresh, "second call returns the memo")


if __name__ == "__main__":
    unittest.main()
