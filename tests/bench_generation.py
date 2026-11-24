"""Benchmark for the requirement-based generator (simple / medium / complex briefs).

    python -m tests.bench_generation out.json [--profile]

Measures wall time of one uncached ``generate`` call per brief, the number of valid and distinct plans, the
verifier result for each plan, and the engine's own stage counters.  The search is seeded, so quality figures are
comparable between runs; wall time is the quantity being optimised.
"""
import cProfile, json, pstats, sys, time

from backend.planner.architect import service


def rooms(bhk, extra=()):
    names = ["living_room", "dining", "kitchen", "utility", "master_bedroom"] + ["bedroom"] * (bhk - 1) \
        + ["bathroom"] * bhk + list(extra)
    return [{"room_type": t} for t in names]


CASES = {
    "simple":  dict(plot_width=30, plot_length=50, road_side="South", building_type="Ground", rooms=rooms(2),
                    vastu_mode="basic", balcony_required=False),
    "medium":  dict(plot_width=30, plot_length=40, road_side="South", building_type="G+1", rooms=rooms(3),
                    vastu_mode="basic", balcony_required=True, strict=False),
    "complex": dict(plot_width=40, plot_length=60, road_side="West", building_type="G+2", rooms=rooms(4, ["puja_room", "study"]),
                    vastu_mode="strict", balcony_required=True, parking_required=True, parking_spaces=2, strict=False),
}


def signature(plan):
    sig = []
    for f in plan["floors"]:
        for r in f["layout"]["rooms"]:
            sig.append((r["room_type"], round(r["x"], 1), round(r["y"], 1), round(r["width"], 1), round(r["length"], 1)))
    return tuple(sorted(sig))


def run(name, payload, profile=False):
    service._CACHE = None
    pr = cProfile.Profile() if profile else None
    t0 = time.perf_counter()
    if pr:
        pr.enable()
    try:
        res = service.generate(dict(payload), budget_s=12)
        err = None
    except Exception as exc:                      # a brief the engine cannot plan is a result too
        res, err = None, f"{type(exc).__name__}: {str(exc)[:120]}"
    dt = time.perf_counter() - t0
    if pr:
        pr.disable()
        pstats.Stats(pr).sort_stats("cumulative").dump_stats(f"/tmp/bench_{name}.prof")
    out = {"case": name, "seconds": round(dt, 2), "error": err}
    if res:
        plans = res["plans"]
        out.update(plans=len(plans), unique=len({signature(p) for p in plans}),
                   verified=sum(1 for p in plans if p["verification"]["passed"]),
                   rooms=[sum(len(f["layout"]["rooms"]) for f in p["floors"]) for p in plans],
                   scores=[p.get("quality_score") for p in plans],
                   search=res.get("search"), relaxation_level=(res.get("relaxation") or {}).get("level"),
                   warnings=len(res.get("warnings", [])))
    return out


if __name__ == "__main__":
    path = sys.argv[1]
    prof = "--profile" in sys.argv
    only = [a for a in sys.argv[2:] if a in CASES] or list(CASES)
    results = []
    for n in only:
        r = run(n, CASES[n], prof)
        print(json.dumps(r, default=str), flush=True)
        results.append(r)
        json.dump(results, open(path, "w"), indent=1, default=str)
