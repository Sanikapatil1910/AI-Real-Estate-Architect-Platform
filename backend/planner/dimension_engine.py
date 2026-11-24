from copy import deepcopy

from backend.planner.style_knowledge import (
    get_room_size_factor,
    get_style_profile,
)


# ============================================================
# ROOM DIMENSION RANGES
# ============================================================

ROOM_DIMENSION_RANGES = {

    "living_room": {
        "min_width": 10,
        "max_width": 16,
        "min_length": 12,
        "max_length": 20,
        "preferred_area": 180,
    },

    "dining": {
        "min_width": 8,
        "max_width": 14,
        "min_length": 8,
        "max_length": 16,
        "preferred_area": 120,
    },

    "kitchen": {
        "min_width": 7,
        "max_width": 12,
        "min_length": 8,
        "max_length": 14,
        "preferred_area": 100,
    },

    "utility": {
        "min_width": 5,
        "max_width": 8,
        "min_length": 6,
        "max_length": 10,
        "preferred_area": 45,
    },

    "master_bedroom": {
        "min_width": 10,
        "max_width": 15,
        "min_length": 11,
        "max_length": 17,
        "preferred_area": 160,
    },

    "bedroom": {
        "min_width": 9,
        "max_width": 13,
        "min_length": 10,
        "max_length": 15,
        "preferred_area": 120,
    },

    "guest_bedroom": {
        "min_width": 9,
        "max_width": 13,
        "min_length": 10,
        "max_length": 15,
        "preferred_area": 120,
    },

    "bathroom": {
        "min_width": 5,
        "max_width": 8,
        "min_length": 6,
        "max_length": 10,
        "preferred_area": 45,
    },

    "puja_room": {
        "min_width": 4,
        "max_width": 7,
        "min_length": 5,
        "max_length": 9,
        "preferred_area": 35,
    },
        "staircase": {
        "min_width": 7,
        "max_width": 10,
        "min_length": 14,
        "max_length": 18,
        "preferred_area": 105,
    },
}


# ============================================================
# PLAN STRATEGIES
# ============================================================

PLAN_STRATEGIES = {

    "space_efficient": {
        "area_factor": 0.90,
        "description": "Compact rooms with efficient circulation."
    },

    "balanced": {
        "area_factor": 1.00,
        "description": "Balanced room sizes and circulation."
    },

    "comfort": {
        "area_factor": 1.10,
        "description": "More generous room sizes for comfort."
    },

    "luxury": {
        "area_factor": 1.20,
        "description": "Larger common and private spaces."
    },
}


# ============================================================
# HELPER
# ============================================================

def clamp(value, minimum, maximum):
    return max(minimum, min(value, maximum))


# ============================================================
# CALCULATE ROOM AREA
# ============================================================

def calculate_target_area(
    room_type,
    strategy="balanced",
    floor_area=None,
    style="Modern Minimalistic",
):
    """
    Calculate a target area for a room.

    The strategy changes the target size while
    respecting the room's allowed range.
    """

    if room_type not in ROOM_DIMENSION_RANGES:
        raise ValueError(
            f"Unknown room type: {room_type}"
        )

    rule = ROOM_DIMENSION_RANGES[room_type]

    factor = PLAN_STRATEGIES.get(
        strategy,
        PLAN_STRATEGIES["balanced"]
    )["area_factor"]

    style_factor = get_room_size_factor(style, room_type)
    target_area = (
        rule["preferred_area"] * factor * style_factor
    )

    # If floor area is provided, prevent a single
    # room from consuming an unreasonable portion.
    if floor_area is not None:

        max_allowed = floor_area * 0.35

        target_area = min(
            target_area,
            max_allowed
        )

    minimum_area = (
        rule["min_width"] *
        rule["min_length"]
    )

    maximum_area = (
        rule["max_width"] *
        rule["max_length"]
    )

    target_area = clamp(
        target_area,
        minimum_area,
        maximum_area
    )

    return round(target_area, 2)


# ============================================================
# FIND REALISTIC WIDTH / LENGTH
# ============================================================

def choose_room_dimensions(
    room_type,
    strategy="balanced",
    floor_area=None,
    orientation="normal",
    style="Modern Minimalistic",
):
    """
    Choose realistic width and length for a room.

    Different strategies produce different
    dimensions.
    """

    if room_type not in ROOM_DIMENSION_RANGES:
        raise ValueError(
            f"Unknown room type: {room_type}"
        )

    rule = ROOM_DIMENSION_RANGES[room_type]

    target_area = calculate_target_area(
        room_type=room_type,
        strategy=strategy,
        floor_area=floor_area,
        style=style,
    )

    min_width = rule["min_width"]
    max_width = rule["max_width"]

    min_length = rule["min_length"]
    max_length = rule["max_length"]

    # Start from a reasonable width.
    width = (
        target_area ** 0.5
    )

    width = clamp(
        width,
        min_width,
        max_width
    )

    length = (
        target_area / width
    )

    length = clamp(
        length,
        min_length,
        max_length
    )

    # Recalculate width if length was clamped.
    width = target_area / length

    width = clamp(
        width,
        min_width,
        max_width
    )

    # Architectural style can influence proportions, not just colors.
    openness = float(get_style_profile(style).get("preferred_openness", 0.65))
    elongation = 1.0 + (1.0 - openness) * 0.25
    if room_type in {"living_room", "dining", "master_bedroom"}:
        length = min(max_length, max(min_length, length * elongation))
        width = min(max_width, max(min_width, target_area / max(length, 0.1)))

    # Orientation can intentionally swap
    # the room's width and length.
    if orientation == "swapped":

        width, length = length, width

    return {
        "room_type": room_type,
        "width": round(width, 2),
        "length": round(length, 2),
        "area": round(width * length, 2),
        "strategy": strategy,
    }


# ============================================================
# GENERATE DIMENSIONS FOR ALL ROOMS
# ============================================================

def generate_room_dimensions(
    rooms,
    strategy="balanced",
    floor_area=None,
    swap_selected=False,
    style="Modern Minimalistic",
):
    """
    Generate dimensions for an entire room list.

    Each room receives its own calculated dimensions.
    """

    result = []

    for index, room in enumerate(
        deepcopy(rooms)
    ):

        room_type = room["room_type"]

        orientation = "normal"

        if swap_selected and index % 2 == 1:
            orientation = "swapped"

        dimensions = choose_room_dimensions(
            room_type=room_type,
            strategy=strategy,
            floor_area=floor_area,
            orientation=orientation,
            style=style,
        )

        room["width"] = dimensions["width"]
        room["length"] = dimensions["length"]
        room["area"] = dimensions["area"]
        room["dimension_strategy"] = strategy
        room["architectural_style"] = style

        result.append(room)

    return result


# ============================================================
# COMPARE DIMENSIONS
# ============================================================

def compare_room_dimensions(
    rooms_a,
    rooms_b,
):
    """
    Compare two room lists and identify
    dimension differences.
    """

    differences = []

    for index in range(
        min(len(rooms_a), len(rooms_b))
    ):

        room_a = rooms_a[index]
        room_b = rooms_b[index]

        if (
            room_a.get("room_type")
            != room_b.get("room_type")
        ):
            continue

        if (
            room_a.get("width")
            != room_b.get("width")
            or
            room_a.get("length")
            != room_b.get("length")
        ):

            differences.append({
                "room_type": room_a["room_type"],
                "plan_a": {
                    "width": room_a.get("width"),
                    "length": room_a.get("length"),
                },
                "plan_b": {
                    "width": room_b.get("width"),
                    "length": room_b.get("length"),
                },
            })

    return differences