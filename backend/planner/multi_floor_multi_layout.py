from copy import deepcopy
import random

from backend.planner.multi_floor_generator import generate_floor_layouts
from backend.planner.requirement_engine import apply_requirements
from backend.planner.dimension_engine import generate_room_dimensions
from backend.planner.validator import validate_layout, score_quality_5factor
from backend.planner.validator import validate_bedroom_program, validate_master_bathroom
from backend.planner.staircase_integration import integrate_staircase
from backend.planner.layout_optimizer import TOPOLOGY_PROFILES
from backend.planner.energy_analyzer import analyze_energy
from backend.planner.cost_estimator import estimate_cost
from backend.planner.explanation import explain_plan
from backend.planner.plot_rules import normalize_road_side


PLAN_STRATEGIES = [
    "space_efficient",
    "balanced",
    "comfort",
    "luxury",
]

QUALITY_THRESHOLD = 90.0
MAX_REGEN_ATTEMPTS = 12


def _compute_plan_quality_score(plan_floors, vastu_mode, road_side,
                                required_bedrooms=None, required_bathrooms=None):
    """Compute the aggregate 5-factor quality score across all plan floors."""
    scores = []
    for floor in plan_floors:
        layout = floor.get("layout", {})
        rooms = layout.get("rooms", [])
        if not rooms:
            continue
        layout_for_score = dict(layout)
        layout_for_score["required_bedrooms"] = required_bedrooms
        layout_for_score["required_bathrooms"] = required_bathrooms
        q = score_quality_5factor(
            layout=layout_for_score,
            vastu_mode=vastu_mode,
            road_side=road_side,
            required_bedrooms=required_bedrooms,
            required_bathrooms=required_bathrooms,
        )
        scores.append(q["overall_score"])
    if not scores:
        return 0.0, []
    return round(sum(scores) / len(scores), 2), scores


def _finalize_plan(plan_number, strategy, plan_rooms, building,
                   requirement_result, staircase_required, staircase_info,
                   building_type, normalized_vastu, architectural_style,
                   include_terrace, climate, road_side,
                   required_bedroom_count, required_bathroom_count):
    """Run validation, energy, cost, explanation and return the finished plan dict."""
    floor_results = []
    placed_rooms = [
        room
        for floor in building["floors"]
        for room in floor["layout"].get("rooms", [])
    ]
    bedroom_program = validate_bedroom_program(
        placed_rooms,
        required_bedrooms=required_bedroom_count,
    )
    master_bathroom = validate_master_bathroom(
        placed_rooms,
        bathroom_required=any(room.get("room_type") == "bathroom" for room in plan_rooms),
    )

    for floor in building["floors"]:
        layout = floor["layout"]
        layout["required_bedrooms"] = required_bedroom_count
        layout["required_bathrooms"] = required_bathroom_count
        layout["road_side"] = road_side
        validation = validate_layout(
            layout,
            vastu_mode=normalized_vastu,
        )
        if not layout.get("valid", True):
            validation["valid"] = False
            validation["errors"].extend(
                layout.get("errors", [])
            )
        floor_results.append(
            {
                "floor": floor["floor"],
                "validation": validation,
            }
        )

    energy = {
        floor["floor"]: analyze_energy(
            floor["layout"],
            road_side=road_side,
            climate=climate,
        )
        for floor in building["floors"]
        if floor["layout"].get("rooms")
    }

    concept_stub = {
        "floors": building["floors"],
        "strategy": strategy,
        "topology": TOPOLOGY_PROFILES.get(strategy, "front_public"),
        "vastu_mode": normalized_vastu,
    }
    cost = estimate_cost(building["floors"])
    explanation = explain_plan(concept_stub)

    return {
        "plan_number": plan_number,
        "strategy": strategy,
        "topology": TOPOLOGY_PROFILES.get(
            strategy,
            "front_public",
        ),
        "building_type": building_type,
        "vastu_mode": normalized_vastu,
        "architectural_style": architectural_style,

        "parking": requirement_result[
            "parking"
        ],

        "staircase_required":
            staircase_required,

        "staircase":
            staircase_info,

        "floors":
            building["floors"],

        "terrace":
            building["terrace"],

        "validation":
            floor_results,

        "energy":
            energy,

        "cost":
            cost,

        "explanation":
            explanation,

        "bedroom_program": bedroom_program,
        "master_bathroom": master_bathroom,
    }


def generate_project_plans(
    rooms,
    plot,
    usable_plot,
    building_type="Ground",
    road_side="North",
    number_of_plans=4,
    include_terrace=True,
    parking_required=False,
    parking_spaces=1,
    floor_height=10,
    stair_width=3.5,
    vastu_mode="basic",
    architectural_style="Modern Minimalistic",
    family_context=None,
    climate="Auto",
    balcony_required=False,
    garden_required=False,
    terrace_features=None,
    quality_threshold=QUALITY_THRESHOLD,
    max_regen_attempts=MAX_REGEN_ATTEMPTS,
):
    """
    Generate multiple complete building plans with 90%+ quality enforcement.

    Pipeline:
        Requirements
            ↓
        Staircase Integration
            ↓
        Room Dimensions
            ↓
        Multi-floor Allocation
            ↓
        Road-aware Layout
            ↓
        5-Factor Quality Score (>= 90% enforced via regeneration loop)
    """
    road_side = normalize_road_side(road_side)

    # ---------------------------------------------------------
    # STEP 1: Apply normal room requirements
    # ---------------------------------------------------------

    requirement_result = apply_requirements(
        rooms=rooms,
        building_type=building_type,
        parking_required=parking_required,
        parking_spaces=parking_spaces,
    )

    required_rooms = requirement_result["rooms"]

    # ---------------------------------------------------------
    # STEP 2: Add staircase when required
    # ---------------------------------------------------------

    staircase_result = integrate_staircase(
        rooms=required_rooms,
        building_type=building_type,
        floor_height=floor_height,
        stair_width=stair_width,
    )

    required_rooms = staircase_result["rooms"]

    staircase_info = staircase_result["staircase"]

    staircase_required = staircase_result[
        "staircase_required"
    ]

    # Normalize UI labels into stable backend values.
    normalized_vastu = str(vastu_mode or "no_preference").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized_vastu in {"none", "no"}:
        normalized_vastu = "no_preference"
    if normalized_vastu not in {"no_preference", "basic", "strict"}:
        normalized_vastu = "basic"

    required_bedroom_count = sum(
        1 for r in required_rooms
        if r.get("room_type") in {"master_bedroom", "bedroom"}
    )
    required_bathroom_count = sum(
        1 for r in required_rooms
        if r.get("room_type") == "bathroom"
    )

    # ---------------------------------------------------------
    # STEP 3: Select plan strategies
    # ---------------------------------------------------------

    selected_strategies = PLAN_STRATEGIES[
        :number_of_plans
    ]

    plans = []
    regenerated_plan_stats = []

    # ---------------------------------------------------------
    # STEP 4: Generate each plan with 90% quality enforcement
    # ---------------------------------------------------------

    for plan_number, strategy in enumerate(
        selected_strategies,
        start=1,
    ):
        best_plan = None
        best_score = -1.0
        best_attempt = 0
        attempt_log = []

        for attempt in range(1, max_regen_attempts + 1):
            plan_rooms = deepcopy(
                required_rooms
            )

            # -----------------------------------------------------
            # STEP 5: Generate room dimensions
            #   (jitter sizes slightly per attempt after 1st)
            # -----------------------------------------------------

            if attempt > 1:
                rng = random.Random(attempt * 131 + plan_number * 7)
                for r in plan_rooms:
                    rt = r.get("room_type", "")
                    if rt in {"staircase"}:
                        continue
                    w = float(r.get("width", 0.0))
                    l = float(r.get("length", 0.0))
                    if w > 0 and l > 0:
                        jitter = rng.uniform(-0.06, 0.08)
                        nw = max(w * 0.82, min(w * 1.15, w * (1 + jitter)))
                        jitter2 = rng.uniform(-0.06, 0.08)
                        nl = max(l * 0.82, min(l * 1.15, l * (1 + jitter2)))
                        r["width"] = round(nw, 2)
                        r["length"] = round(nl, 2)
                        r["area"] = round(nw * nl, 2)

            plan_rooms = generate_room_dimensions(
                rooms=plan_rooms,
                strategy=strategy,
                floor_area=usable_plot["area"],
                style=architectural_style,
            )

            # -----------------------------------------------------
            # STEP 6: Generate multi-floor building
            # -----------------------------------------------------

            building = generate_floor_layouts(
                rooms=plan_rooms,
                plot=plot,
                usable_plot=usable_plot,
                building_type=building_type,
                road_side=road_side,
                include_terrace=include_terrace,
                strategy=strategy,
                vastu_mode=normalized_vastu,
                family_context=family_context,
                architectural_style=architectural_style,
                climate=climate,
                parking=requirement_result["parking"],
                balcony_required=balcony_required,
                garden_required=garden_required,
                terrace_features=terrace_features,
            )

            # -----------------------------------------------------
            # STEP 7: Compute 5-factor quality score
            # -----------------------------------------------------

            agg_score, per_floor_scores = _compute_plan_quality_score(
                building["floors"],
                normalized_vastu,
                road_side,
                required_bedrooms=required_bedroom_count,
                required_bathrooms=required_bathroom_count,
            )

            attempt_log.append({
                "attempt": attempt,
                "score": agg_score,
                "per_floor": per_floor_scores,
                "strategy": strategy,
            })

            if agg_score >= best_score:
                best_score = agg_score
                best_plan = (
                    strategy, plan_rooms, building
                )
                best_attempt = attempt

            if agg_score >= quality_threshold:
                break

        strategy_best, plan_rooms_best, building_best = best_plan or (
            strategy, deepcopy(required_rooms), {"floors": [], "terrace": None}
        )

        regenerated_plan_stats.append({
            "plan_number": plan_number,
            "strategy": strategy_best,
            "attempts": len(attempt_log),
            "best_attempt": best_attempt,
            "best_score": best_score,
            "threshold": quality_threshold,
            "passes_threshold": best_score >= quality_threshold,
            "attempt_log": attempt_log,
        })

        # -----------------------------------------------------
        # STEP 8-9: Finalize the best plan (validation / explanation)
        # -----------------------------------------------------

        plan = _finalize_plan(
            plan_number=plan_number,
            strategy=strategy_best,
            plan_rooms=plan_rooms_best,
            building=building_best,
            requirement_result=requirement_result,
            staircase_required=staircase_required,
            staircase_info=staircase_info,
            building_type=building_type,
            normalized_vastu=normalized_vastu,
            architectural_style=architectural_style,
            include_terrace=include_terrace,
            climate=climate,
            road_side=road_side,
            required_bedroom_count=required_bedroom_count,
            required_bathroom_count=required_bathroom_count,
        )

        plan["quality_score"] = round(best_score, 2)
        plan["passes_90_percent"] = best_score >= quality_threshold
        plan["regeneration_attempts"] = len(attempt_log)
        plan["best_attempt_index"] = best_attempt

        plans.append(plan)

    # ---------------------------------------------------------
    # FINAL PROJECT RESULT
    # ---------------------------------------------------------

    return {
        "building_type": building_type,

        "parking":
            requirement_result["parking"],

        "staircase_required":
            staircase_required,

        "staircase":
            staircase_info,

        "total_plans":
            len(plans),

        "quality_threshold":
            quality_threshold,

        "quality_summary": {
            "all_pass": all(p.get("passes_90_percent", False) for p in plans),
            "min_score": round(min((p.get("quality_score", 0) for p in plans), default=0), 2),
            "max_score": round(max((p.get("quality_score", 0) for p in plans), default=0), 2),
            "avg_score": round(
                sum(p.get("quality_score", 0) for p in plans) / len(plans), 2
            ) if plans else 0.0,
            "plans_passing": sum(1 for p in plans if p.get("passes_90_percent")),
            "plans_total": len(plans),
        },

        "regeneration_stats": regenerated_plan_stats,

        "plans":
            plans,
    }