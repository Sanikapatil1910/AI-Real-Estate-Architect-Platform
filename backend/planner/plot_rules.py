from typing import Dict


ROAD_SIDES = {
    "north": "North",
    "south": "South",
    "east": "East",
    "west": "West",
}


def normalize_road_side(road_side: str) -> str:
    """Return the canonical display value for a supported road side."""
    try:
        return ROAD_SIDES[str(road_side).strip().lower()]
    except KeyError as exc:
        raise ValueError(
            "Road side must be North, South, East or West."
        ) from exc


def calculate_usable_plot(
    plot_width: float,
    plot_length: float,
    front_setback: float = 0,
    rear_setback: float = 0,
    left_setback: float = 0,
    right_setback: float = 0
) -> Dict:
    """
    Calculate the usable construction area after setbacks.

    All dimensions are in feet.
    """

    errors = []

    if plot_width <= 0:
        errors.append("Plot width must be greater than zero.")

    if plot_length <= 0:
        errors.append("Plot length must be greater than zero.")

    setbacks = {
        "front": front_setback,
        "rear": rear_setback,
        "left": left_setback,
        "right": right_setback
    }

    for name, value in setbacks.items():
        if value < 0:
            errors.append(
                f"{name.capitalize()} setback cannot be negative."
            )

    usable_width = plot_width - left_setback - right_setback
    usable_length = plot_length - front_setback - rear_setback

    if usable_width <= 0:
        errors.append(
            "Setbacks leave no usable plot width."
        )

    if usable_length <= 0:
        errors.append(
            "Setbacks leave no usable plot length."
        )

    if errors:
        return {
            "valid": False,
            "errors": errors
        }

    plot_area = plot_width * plot_length
    usable_area = usable_width * usable_length

    return {
        "valid": True,
        "plot": {
            "width": plot_width,
            "length": plot_length,
            "area": round(plot_area, 2)
        },
        "setbacks": {
            "front": front_setback,
            "rear": rear_setback,
            "left": left_setback,
            "right": right_setback
        },
        "usable_plot": {
            "width": round(usable_width, 2),
            "length": round(usable_length, 2),
            "area": round(usable_area, 2)
        },
        "errors": []
    }


def validate_road_side(road_side: str) -> Dict:
    """
    Validate road direction.

    Supported:
        North
        South
        East
        West
    """

    try:
        road = normalize_road_side(road_side)
    except ValueError:
        return {
            "valid": False,
            "road_side": road_side,
            "error": (
                "Road side must be North, South, East or West."
            )
        }

    return {
        "valid": True,
        "road_side": road
    }


def create_plot(
    plot_width: float,
    plot_length: float,
    road_side: str,
    front_setback: float = 0,
    rear_setback: float = 0,
    left_setback: float = 0,
    right_setback: float = 0
) -> Dict:
    """
    Create the complete plot configuration.
    """

    road_result = validate_road_side(road_side)

    if not road_result["valid"]:
        return road_result

    plot_result = calculate_usable_plot(
        plot_width=plot_width,
        plot_length=plot_length,
        front_setback=front_setback,
        rear_setback=rear_setback,
        left_setback=left_setback,
        right_setback=right_setback
    )

    if not plot_result["valid"]:
        return plot_result

    return {
        "valid": True,
        "road_side": road_result["road_side"],
        **plot_result
    }