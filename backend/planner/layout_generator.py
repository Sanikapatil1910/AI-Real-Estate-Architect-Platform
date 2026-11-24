from typing import List, Dict


def create_room(
    room_type: str,
    x: float,
    y: float,
    width: float,
    length: float
) -> Dict:
    """
    Create a rectangular room.

    x, y = bottom-left corner
    width = horizontal dimension
    length = vertical dimension
    """

    return {
        "room_type": room_type,
        "x": round(x, 2),
        "y": round(y, 2),
        "width": round(width, 2),
        "length": round(length, 2),
        "area": round(width * length, 2),
        "x2": round(x + width, 2),
        "y2": round(y + length, 2),
    }


def generate_layout_with_setbacks(
    plot_width: float,
    plot_length: float,
    front_setback: float,
    rear_setback: float,
    left_setback: float,
    right_setback: float,
    rooms: List[Dict]
) -> Dict:
    """
    Generate a room layout only inside the usable area
    remaining after setbacks.

    Coordinate system:

        (0, plot_length)
        ┌──────────────────────────┐
        │                          │
        │       USABLE AREA        │
        │                          │
        └──────────────────────────┘
        (0,0)

    All dimensions are in feet.
    """

    errors = []

    # --------------------------------------------------
    # 1. Validate plot dimensions
    # --------------------------------------------------

    if plot_width <= 0 or plot_length <= 0:
        return {
            "valid": False,
            "errors": ["Plot dimensions must be greater than zero."],
            "rooms": []
        }

    # --------------------------------------------------
    # 2. Validate setbacks
    # --------------------------------------------------

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

    # --------------------------------------------------
    # 3. Calculate usable construction area
    # --------------------------------------------------

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
            "errors": errors,
            "rooms": []
        }

    # --------------------------------------------------
    # 4. Usable area starts after left + front setback
    # --------------------------------------------------

    start_x = left_setback
    start_y = front_setback

    # --------------------------------------------------
    # 5. Place rooms row by row
    # --------------------------------------------------

    generated_rooms = []

    current_x = start_x
    current_y = start_y
    current_row_height = 0

    for room in rooms:

        room_type = room["room_type"]
        width = float(room["width"])
        length = float(room["length"])

        # ----------------------------------------------
        # Check room itself
        # ----------------------------------------------

        if width <= 0 or length <= 0:
            errors.append(
                f"{room_type} must have positive dimensions."
            )
            continue

        # ----------------------------------------------
        # Room cannot be larger than usable area
        # ----------------------------------------------

        if width > usable_width or length > usable_length:
            errors.append(
                f"{room_type} ({width} x {length} ft) "
                f"does not fit inside the usable construction area."
            )
            continue

        # ----------------------------------------------
        # Move to next row if room doesn't fit
        # ----------------------------------------------

        if current_x + width > start_x + usable_width:

            current_x = start_x
            current_y += current_row_height
            current_row_height = 0

        # ----------------------------------------------
        # Check vertical boundary
        # ----------------------------------------------

        if current_y + length > start_y + usable_length:

            errors.append(
                f"Not enough usable space to place "
                f"{room_type} ({width} x {length} ft)."
            )
            continue

        # ----------------------------------------------
        # Create room
        # ----------------------------------------------

        new_room = create_room(
            room_type=room_type,
            x=current_x,
            y=current_y,
            width=width,
            length=length
        )

        generated_rooms.append(new_room)

        # ----------------------------------------------
        # Move horizontally
        # ----------------------------------------------

        current_x += width

        # Keep tallest room in current row
        current_row_height = max(
            current_row_height,
            length
        )

    # --------------------------------------------------
    # 6. Calculate used room area
    # --------------------------------------------------

    used_area = sum(
        room["area"]
        for room in generated_rooms
    )

    usable_area = usable_width * usable_length

    # --------------------------------------------------
    # 7. Return complete result
    # --------------------------------------------------

    return {
        "valid": len(errors) == 0,

        "plot": {
            "width": plot_width,
            "length": plot_length,
            "area": round(plot_width * plot_length, 2)
        },

        "setbacks": {
            "front": front_setback,
            "rear": rear_setback,
            "left": left_setback,
            "right": right_setback
        },

        "usable_plot": {
            "x": round(start_x, 2),
            "y": round(start_y, 2),
            "width": round(usable_width, 2),
            "length": round(usable_length, 2),
            "area": round(usable_area, 2)
        },

        "rooms": generated_rooms,

        "used_room_area": round(used_area, 2),

        "remaining_area": round(
            usable_area - used_area,
            2
        ),

        "errors": errors
    }