"""Regenerate the generator-made plan fixtures used by the circulation / parking / best-effort render tests.

    python -m tests.gen_fixtures            # writes frontend-react/dev/fixtures/{cf_g1_terrace,cf_g2,cf_g1_wide,sc_*}.json

`sc_*` are the strict-compliance plans (exact room counts, G+1 / G+2, frontage 50 / 60, 1 car) used by test_strict_render.
`cf_bad_terrace_route.json` is NOT touched: it is a deliberately broken plan that the circulation detector must keep rejecting.
Every plan is checked (verifier + building-wide circulation) before it is written, so a fixture can never encode a defect.
"""
import json
import sys
from pathlib import Path

from backend.planner.architect import service
from backend.planner.architect.rules import set_compact, set_strict

FIX = Path(__file__).resolve().parents[1] / "frontend-react" / "dev" / "fixtures"


def rooms(beds, baths, extra=()):
    names = ["living_room", "dining", "kitchen", "utility", "master_bedroom"] + ["bedroom"] * (beds - 1) + ["bathroom"] * baths + list(extra)
    return [{"room_type": t} for t in names]


def base(**kw):
    p = dict(vastu_mode="basic", parking_required=False, parking_spaces=0, parking_type="No Parking", strict=True, number_of_plans=4,
             include_terrace=False, setbacks={"front": 0, "rear": 0, "left": 0, "right": 0})
    p.update(kw)
    return p


def sc(**kw):
    kw.setdefault("setbacks", {"front": 5, "rear": 3, "left": 3, "right": 3})
    return base(**kw)


SPECS = {
    "sc_a_f50": sc(plot_width=50, plot_length=60, frontage_ft=50, road_side="South", building_type="G+1", rooms=rooms(4, 3)),
    "sc_b_f60": sc(plot_width=50, plot_length=60, frontage_ft=60, road_side="East", building_type="G+1", rooms=rooms(4, 3)),
    "sc_g2": sc(plot_width=40, plot_length=60, road_side="East", building_type="G+2", rooms=rooms(4, 4)),
    "sc_car": sc(plot_width=40, plot_length=60, road_side="South", building_type="G+1", rooms=rooms(3, 3), parking_required=True, parking_spaces=1,
                 parking_type="1 Car"),
    "sc_terrace": sc(plot_width=50, plot_length=60, road_side="North", building_type="G+1", rooms=rooms(4, 3), include_terrace=True),
    "cf_g1_terrace": base(plot_width=30, plot_length=40, road_side="South", building_type="G+1", rooms=rooms(2, 2, ["puja_room"]), balcony_required=True),
    "sc_balcony": sc(plot_width=50, plot_length=60, road_side="South", building_type="G+1", rooms=rooms(4, 3), balcony_required=True, include_terrace=True),
    "sc_g2_balcony": sc(plot_width=40, plot_length=60, road_side="North", building_type="G+2", rooms=rooms(4, 4), balcony_required=True),
    "cf_g2": base(plot_width=40, plot_length=60, road_side="North", building_type="G+2", rooms=rooms(4, 4)),
    "cf_g1_wide": base(plot_width=50, plot_length=30, road_side="North", building_type="G+1", rooms=rooms(2, 2)),
}


def main(names=None):
    for name, spec in SPECS.items():
        if names and name not in names:
            continue
        set_strict(True)
        set_compact(1.0)
        res = service.generate(dict(spec), budget_s=10.0)
        plan = res["plans"][0]
        assert plan["verification"]["passed"], plan["verification"]["errors"]
        assert all(not f["issues"] for f in plan["circulation"]["floors"])
        plan["compliance"] = res["compliance"]
        (FIX / f"{name}.json").write_text(json.dumps(plan, indent=1))
        print(name, "ok", "score", res["compliance"]["score"], "floors", len(plan["floors"]))


if __name__ == "__main__":
    main(sys.argv[1:] or None)
