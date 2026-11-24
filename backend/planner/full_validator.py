from backend.planner.validator import validate_layout
from backend.planner.road_planner import analyze_road_layout


def validate_full_layout(
    layout,
    plot,
    usable_plot,
    road_side="North",
    vastu_mode="basic"
):
    """
    Complete layout validator.

    Combines:
    1. Standard architectural/layout validation
    2. Road-aware validation
    3. Functional score
    4. Vastu score
    5. Road score
    """

    # --------------------------------------------------
    # Prepare complete layout
    # --------------------------------------------------

    complete_layout = dict(layout)

    complete_layout["plot"] = plot
    complete_layout["usable_plot"] = usable_plot

    # --------------------------------------------------
    # Standard validation
    # --------------------------------------------------

    validation = validate_layout(
        complete_layout,
        vastu_mode=vastu_mode
    )

    # --------------------------------------------------
    # Road validation
    # --------------------------------------------------

    rooms = complete_layout.get("rooms", [])

    road_analysis = analyze_road_layout(
        rooms=rooms,
        usable_plot=usable_plot,
        road_side=road_side
    )

    # --------------------------------------------------
    # Collect errors and warnings
    # --------------------------------------------------

    errors = list(
        validation.get("errors", [])
    )

    warnings = list(
        validation.get("warnings", [])
    )

    if not road_analysis["valid"]:

        warnings.extend(
            road_analysis.get("warnings", [])
        )

    # --------------------------------------------------
    # Final result
    # --------------------------------------------------

    return {
        "valid": (
            validation.get("valid", False)
            and road_analysis.get("valid", False)
        ),

        "overall_score": validation.get(
            "overall_score",
            0
        ),

        "functional_score": validation.get(
            "scores",
            {}
        ).get(
            "functional",
            0
        ),

        "vastu_score": validation.get(
            "scores",
            {}
        ).get(
            "vastu",
            0
        ),

        "road_score": road_analysis.get(
            "road_score",
            0
        ),

        "room_count": len(rooms),

        "errors": errors,

        "warnings": warnings,

        "road_analysis": road_analysis
    }