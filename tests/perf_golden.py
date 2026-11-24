"""Deterministic fingerprints of the generator's inner steps, used to prove that speed-ups do not change results.

``python -m tests.perf_golden out.json`` writes the fingerprint; tests/test_perf_equivalence.py compares it with the stored one.
The random search is replayed with fixed seeds (python's global ``random`` is seeded too), then every structure it builds and
every floor it realises is reduced to a hash.  Any change to the order of random draws or to a computed size shows up here.
"""
import hashlib, json, random, sys

from backend.planner.architect import service
from backend.planner.architect.feasibility import _site_and_program, available_box
from backend.planner.architect.rules import STRICT, set_strict, set_compact
from backend.planner.architect.sizing import band_depth_options  # noqa: F401
from tests.bench_generation import CASES


def struct_sig(st):
    out = [st.family, st.A, st.B, st.pin_b0]
    for b in st.bands:
        out.append((b.kind, b.fixed_depth, [([(tuple(s.id for s in c.specs), c.fixed_w, c.min_w) for c in cells], ext) for cells, ext in b.segments]))
    return repr(out)


def fingerprint(tries=120):
    import time
    from backend.planner.architect.engine import _gen_floor, _pin_candidates
    from backend.planner.architect.rules import GRID
    from backend.planner.architect.site import snap_down
    fp = {}
    import itertools
    from backend.planner.architect import layout as _layout
    _layout._PASS_IDS = itertools.count(100)       # passage ids are part of the structure signature: start from the same number every time
    from backend.planner.architect.rules import set_aspect
    for name, cfg in [(n, c) for n in CASES for c in ("strict", "compact")]:
        payload = CASES[name]
        p = dict(payload)
        p["rooms"] = [dict(r) for r in p["rooms"]]
        p["vastu_mode"] = service._normalise_vastu(p.get("vastu_mode"))
        set_strict(p.get("strict", True) is not False)
        set_compact(1.0)
        if cfg == "compact":
            set_compact(0.85)
            STRICT.update({"util_corner": False, "bath_ext": True, "max_pass": 4, "passage_ok": True, "pass_cap": False})
            set_aspect(1.6)
        site, program = _site_and_program(p)
        box = available_box(site)
        F, D = snap_down(box["frontage"], GRID), snap_down(box["depth"], GRID)
        nfl = len(program.floors)
        sigs = []
        for seed in range(4):
            for family in ("rows", "cols"):
                rng = random.Random(seed * 7 + 1)
                random.seed(seed)
                A, B = (F, D) if family == "rows" else (D, F)
                pin = None
                if nfl > 1:
                    pin = _pin_candidates(rng, A, B, program.stair_dims, 0.0)
                    if pin is None:
                        sigs.append("nopin")
                        continue
                for fi, flr in enumerate(program.floors):
                    sols = _gen_floor(rng, flr, fi, nfl, F, D, family, pin, tries, {s_.id: s_.target for s_ in flr.all_specs()}, time.time() + 1e9)
                    for sol in sols:
                        sigs.append(repr((round(sol.cost, 6), round(sum(sol.ev.features.values()), 6),
                                          sorted((r.id, r.type, round(r.u, 3), round(r.v, 3), round(r.w, 3), round(r.d, 3)) for r in sol.rooms))))
                    sigs.append(f"floor{fi}:{len(sols)}")
        fp[name + "_" + cfg] = hashlib.sha256("\n".join(sigs).encode()).hexdigest()
        fp[name + "_" + cfg + "_floors_built"] = sum(1 for s_ in sigs if s_.startswith("(")) 
    return fp


if __name__ == "__main__":
    json.dump(fingerprint(), open(sys.argv[1], "w"), indent=1)
    print(open(sys.argv[1]).read())
