"""Staircase geometry from the project's stair rules.

Rules applied (metric, converted for the feet-based plan):
    * floor-to-floor height at least 2.7 m (a lower value is raised to 2.7 m)
    * riser at most 150 mm  -> number of risers = ceil(height / 150 mm), all risers equal
    * tread 300 mm
    * clear landing of 1.0 m at the foot and at the head of the stair, and a mid landing at least
      as deep as the stair is wide (and at least 1.0 m)
    * stair width 1.0 m (3.5 ft by default, changeable; never narrower than 1.0 m)
"""

import math

MM_PER_FT = 304.8
MIN_FLOOR_HEIGHT_FT = 2700 / MM_PER_FT         # 2.7 m = 8.86 ft
MAX_RISER_MM = 150.0
TREAD_MM = 300.0
LANDING_FT = 1000 / MM_PER_FT                  # 1.0 m = 3.28 ft
MIN_STAIR_WIDTH_FT = 1000 / MM_PER_FT

DEFAULT_RISER = MAX_RISER_MM / 25.4            # inches (kept for callers that pass inches)
DEFAULT_TREAD = TREAD_MM / 25.4
DEFAULT_STAIR_WIDTH = 3.5


def calculate_staircase(
    floor_height,
    riser_height=DEFAULT_RISER,
    tread_depth=DEFAULT_TREAD,
    stair_width=DEFAULT_STAIR_WIDTH,
    max_riser_mm=None,
    tread_mm=None,
):
    """Dog-leg staircase for one storey.

    Units in: floor_height feet, riser_height / tread_depth inches, stair_width feet.
    """
    if floor_height <= 0:
        raise ValueError("Floor height must be greater than zero.")
    if riser_height <= 0:
        raise ValueError("Riser height must be greater than zero.")
    if tread_depth <= 0:
        raise ValueError("Tread depth must be greater than zero.")
    if stair_width <= 0:
        raise ValueError("Stair width must be greater than zero.")

    notes = []
    if floor_height < MIN_FLOOR_HEIGHT_FT - 1e-9:
        notes.append("Floor height raised to the 2.7 m minimum.")
        floor_height = MIN_FLOOR_HEIGHT_FT
    if stair_width < MIN_STAIR_WIDTH_FT - 1e-9:
        notes.append("Stair width raised to the 1.0 m minimum.")
        stair_width = MIN_STAIR_WIDTH_FT
    tread_mm_arg = tread_mm
    riser_max_mm = max_riser_mm if max_riser_mm else min(MAX_RISER_MM, riser_height * 25.4)
    tread_mm = tread_mm if tread_mm else tread_depth * 25.4

    height_mm = floor_height * MM_PER_FT
    riser_count = max(2, math.ceil(height_mm / riser_max_mm - 1e-9))
    actual_riser_mm = height_mm / riser_count
    actual_riser = actual_riser_mm / 25.4

    r1 = riser_count // 2
    r2 = riser_count - r1
    t1, t2 = max(1, r1 - 1), max(1, r2 - 1)             # the last riser of a flight lands on the landing / floor
    run1 = t1 * tread_mm / MM_PER_FT
    run2 = t2 * tread_mm / MM_PER_FT
    tread_count = t1 + t2
    mid_landing = max(stair_width, LANDING_FT)
    comfort = 2 * actual_riser + tread_depth

    return {
        "floor_height": round(floor_height, 2),
        "floor_height_inches": round(floor_height * 12, 2),
        "floor_height_mm": round(height_mm),
        "riser_height_inches": round(actual_riser, 2),
        "riser_height_mm": round(actual_riser_mm, 1),
        "target_riser_inches": round(riser_max_mm / 25.4, 2),
        "tread_depth_inches": round(tread_depth, 2),
        "tread_depth_mm": round(tread_mm),
        "stair_width_feet": round(stair_width, 2),
        "stair_width_mm": round(stair_width * MM_PER_FT),
        "riser_count": riser_count,
        "tread_count": tread_count,
        "horizontal_run_feet": round(run1 + run2, 2),
        "calculated_height_feet": round(riser_count * actual_riser / 12, 2),
        "comfort_formula": round(comfort, 2),
        "profile": "compact" if (max_riser_mm or tread_mm_arg) else "project",
        "comfort_ok": 23 <= comfort <= 25 or (actual_riser_mm <= MAX_RISER_MM + 1e-6 and tread_mm >= 300 - 1e-6),
        "rules_ok": (actual_riser_mm <= 190.0 + 1e-6 and tread_mm >= 250 - 1e-6 if (max_riser_mm or tread_mm_arg)
                     else actual_riser_mm <= MAX_RISER_MM + 1e-6 and tread_mm >= 300 - 1e-6) and height_mm >= 2700 - 1e-6,
        "configuration": "dog_leg",
        "flight_count": 2,
        "landing": {                      # the half landing between the two flights
            "width_feet": round(stair_width * 2, 2),
            "depth_feet": round(mid_landing, 2),
        },
        "entry_landing_feet": round(LANDING_FT, 2),   # clear space at the foot (and head) of the stair
        "flights": [
            {"name": "first_flight", "riser_count": r1, "tread_count": t1, "run_feet": round(run1, 2),
             "direction": "up"},
            {"name": "second_flight", "riser_count": r2, "tread_count": t2, "run_feet": round(run2, 2),
             "direction": "up_reverse"},
        ],
        "notes": notes,
    }


def calculate_staircase_for_building(
    building_type,
    floor_height,
    riser_height=DEFAULT_RISER,
    tread_depth=DEFAULT_TREAD,
    stair_width=DEFAULT_STAIR_WIDTH,
):
    """
    Calculate staircase requirements for a building type.
    """

    floor_connections = {
        "Ground": 0,
        "G+1": 1,
        "Duplex": 1,
        "G+2": 2,
        "Villa": 2,
    }

    if building_type not in floor_connections:
        raise ValueError(
            f"Unsupported building type: {building_type}"
        )

    connection_count = floor_connections[
        building_type
    ]

    staircase = calculate_staircase(
        floor_height=floor_height,
        riser_height=riser_height,
        tread_depth=tread_depth,
        stair_width=stair_width,
    )

    staircase["building_type"] = building_type

    staircase["floor_connections"] = (
        connection_count
    )

    return staircase