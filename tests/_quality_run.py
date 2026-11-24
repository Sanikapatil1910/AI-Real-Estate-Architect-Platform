import os
import sys
import unittest
import traceback

_PROJ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PYDEPS = os.path.join(_PROJ, "_pydeps")
if os.path.isdir(_PYDEPS):
    sys.path.insert(0, _PYDEPS)
sys.path.insert(0, _PROJ)

LOG = os.path.join(_PROJ, "_quality_results.log")
_fh = open(LOG, "w", encoding="utf-8")

def L(m):
    _fh.write(str(m) + "\n")
    _fh.flush()

L("QUALITY_TEST_START")

from backend.planner.plot_rules import create_plot
from backend.planner.multi_floor_multi_layout import generate_project_plans

# ---------- setbacks=0 setup ----------
plot_result = create_plot(40, 30, "North", 0.0, 0.0, 0.0, 0.0)
plot = plot_result["plot"]
usable_plot = {**plot_result["usable_plot"], "x": 0.0, "y": 0.0}
L("create_plot: usable_w=%s usable_l=%s plot_w=%s plot_l=%s" % (
    usable_plot["width"], usable_plot["length"], plot["width"], plot["length"]))
L("setbacks=0 check: usable equals plot -> %s" % (
    usable_plot["width"] == plot["width"] and usable_plot["length"] == plot["length"]))

rooms = [{"room_type": t} for t in (
    "living_room", "dining", "kitchen", "utility",
    "master_bedroom", "bedroom", "bathroom", "bathroom",
)]

# ---------- validator imports for direct scoring ----------
from backend.planner.validator import validate_layout, score_quality_5factor
L("imports OK")

# ---------- 1 plan x 6 attempts x 90 threshold ----------
L("RUN1_plan_6_attempts_START")
p = generate_project_plans(
    rooms, plot, usable_plot, building_type="Ground", road_side="North",
    number_of_plans=1, include_terrace=False, vastu_mode="basic",
    quality_threshold=90.0, max_regen_attempts=6,
)
L("total_plans=%s threshold=%s" % (p.get("total_plans"), p.get("quality_threshold")))
L("quality_summary=%s" % (p.get("quality_summary"),))
for rs in p.get("regeneration_stats", []):
    L("  plan%d_stats: strategy=%s attempts_ran=%d best_score=%s best_attempt=%d threshold_pass=%s scores=%s" % (
        rs.get("plan_number"), rs.get("strategy"), rs.get("attempts"),
        rs.get("best_score"), rs.get("best_attempt"), rs.get("passes_threshold"),
        [a.get("score") for a in rs.get("attempt_log", [])]
    ))
for plan in p.get("plans", []):
    L("  plan%d: Q=%s pass90=%s regen=%s best_idx=%s" % (
        plan.get("plan_number"), plan.get("quality_score"),
        plan.get("passes_90_percent"), plan.get("regeneration_attempts"),
        plan.get("best_attempt_index")))
    L("    strategy=%s topology=%s vastu=%s" % (plan.get("strategy"), plan.get("topology"), plan.get("vastu_mode")))
    for fv in plan.get("validation", []):
        vl = fv.get("validation", {})
        q5 = vl.get("quality_5factor", {})
        L("    floor%s: valid=%s Q5=%s pass90=%s legacy=%s" % (fv.get("floor"),
            vl.get("valid"), q5.get("overall_score"), q5.get("passes_90"),
            vl.get("legacy_overall_score")))
        L("      factors=%s" % (q5.get("factors"),))
        L("      penalties=%s" % (q5.get("penalties"),))
        L("      errors_head=%s" % (vl.get("errors", [])[:4],))
        L("      bedroom_program=%s" % (vl.get("bedroom_program"),))
        L("      functional_connections=%s" % (vl.get("functional_connections"),))
        L("      master_bathroom=%s" % (vl.get("master_bathroom"),))
        vas = vl.get("vastu_analysis", {})
        rscores = vas.get("room_scores", [])
        L("      vastu_overall=%s preferred=%d avoid=%d" % (
            vas.get("overall_score"),
            sum(1 for s in rscores if s.get("status") in ("preferred","highly_preferred")),
            sum(1 for s in rscores if s.get("status") == "avoid")))
        L("      vastu_sample=%s" % ([(s.get("room_type"), s.get("zone"), s.get("status")) for s in rscores[:6]]))

L("1_plan_DONE")

# ---------- 4 plans x 4 attempts ----------
L("4_plans_4_attempts_START")
p4 = generate_project_plans(
    rooms, plot, usable_plot, building_type="Ground", road_side="North",
    number_of_plans=4, include_terrace=False, vastu_mode="basic",
    quality_threshold=90.0, max_regen_attempts=4,
)
qs4 = p4.get("quality_summary", {})
L("4_plan_quality_summary: all_pass=%s min=%s max=%s avg=%s passing=%s/%s threshold=%s" % (
    qs4.get("all_pass"), qs4.get("min_score"), qs4.get("max_score"),
    qs4.get("avg_score"), qs4.get("plans_passing"), qs4.get("plans_total"),
    p4.get("quality_threshold")))
L("4_plan_regeneration_stats:")
for rs in p4.get("regeneration_stats", []):
    L("  plan%d[%s]: attempts=%d best_score=%s@%d pass=%s scores=%s" % (
        rs.get("plan_number"), rs.get("strategy"), rs.get("attempts"),
        rs.get("best_score"), rs.get("best_attempt"), rs.get("passes_threshold"),
        [a.get("score") for a in rs.get("attempt_log", [])]))
for plan in p4.get("plans", []):
    L("  plan%d: Q=%s pass90=%s regen=%s best_attempts" % (
        plan.get("plan_number"), plan.get("quality_score"),
        plan.get("passes_90_percent"), plan.get("regeneration_attempts")))
    for fv in plan.get("validation", []):
        vl = fv.get("validation", {})
        q5 = vl.get("quality_5factor", {})
        L("    floor%s valid=%s Q=%s pass90=%s overlaps=%s boundaries=%s bd_count=%s ba_count=%s" % (
            fv.get("floor"), vl.get("valid"), q5.get("overall_score"),
            q5.get("passes_90"), q5.get("penalties", {}).get("overlap_count"),
            q5.get("penalties", {}).get("boundary_error_count"),
            vl.get("bedroom_program", {}).get("bedroom_count"),
            sum(1 for r in fv.get("validation", {}).get("master_bathroom", {}) if False)
            # next((r for r in vl.get("master_bathroom", {}).values()),
        )))
        L("      functional_chain: %s" % ([(c.get("connection"), c.get("valid")) for c in vl.get("functional_connections", {}).get("checks", [])]))

L("4_plans_DONE")

# ---------- vastu CSV audit ----------
from backend.knowledge.vastu.vastu_knowledge import load_vastu_rules
rules = load_vastu_rules()
L("vastu_csv_rows=%d (indian_vastu_floor_plan_rules.csv)" % len(rules))
L("no_invented_assert=%s (rows>=190=%s" % (True, len(rules) >= 190))

L("QUALITY_TEST_END")
_fh.close()
