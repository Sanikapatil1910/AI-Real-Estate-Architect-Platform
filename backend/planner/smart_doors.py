from typing import Dict, List

from backend.planner.room_connections import (
    analyze_room_connections
)


# =========================================================
# DOOR WIDTHS
# =========================================================

DOOR_WIDTHS = {
    "main": 4.0,
    "normal": 3.0,
    "bathroom": 2.5,
    "utility": 2.5,
    "puja_room": 2.5
}


# =========================================================
# GET DOOR WIDTH
# =========================================================

def get_door_width(
    room_a: str,
    room_b: str
) -> float:

    if (
        room_a == "bathroom"
        or room_b == "bathroom"
    ):
        return DOOR_WIDTHS["bathroom"]

    if (
        room_a == "utility"
        or room_b == "utility"
    ):
        return DOOR_WIDTHS["utility"]

    if (
        room_a == "puja_room"
        or room_b == "puja_room"
    ):
        return DOOR_WIDTHS["puja_room"]

    return DOOR_WIDTHS["normal"]


# =========================================================
# CREATE SMART INTERNAL DOORS
# =========================================================

def create_smart_internal_doors(
    rooms: List[Dict]
) -> List[Dict]:
    """
    Create doors only where rooms actually share a wall.
    """

    analysis = analyze_room_connections(
        rooms
    )

    doors = []

    for connection in analysis["all_connections"]:

        room_a = connection["room_a"]
        room_b = connection["room_b"]

        # -------------------------------------------------
        # Door width
        # -------------------------------------------------

        width = get_door_width(
            room_a,
            room_b
        )

        # -------------------------------------------------
        # Position from connection analysis
        # -------------------------------------------------

        position = connection["door"]["position"]

        # -------------------------------------------------
        # Store door
        # -------------------------------------------------

        doors.append({
            "type": "door",
            "door_type": "internal",

            "room_a": room_a,
            "room_b": room_b,

            "wall_a": connection["wall_a"],
            "wall_b": connection["wall_b"],

            "shared_wall_length": connection[
                "shared_wall_length"
            ],

            "width": width,

            "position": position,

            "description": (
                f"Internal door connecting "
                f"{room_a} and {room_b}."
            )
        })

    return doors


# =========================================================
# MAIN ENTRANCE
# =========================================================

def create_main_entrance(
    rooms: List[Dict],
    usable_plot: Dict,
    road_side: str = "North"
) -> Dict:
    """
    Create the main entrance only if the living room
    actually touches the road-facing boundary.
    """

    living = None

    for room in rooms:

        if room["room_type"] == "living_room":

            living = room
            break

    if living is None:

        return {
            "valid": False,
            "reason": "Living room not found."
        }

    road = road_side.lower()

    tolerance = 0.01

    # -----------------------------------------------------
    # North
    # -----------------------------------------------------

    if road == "north":

        touches = abs(
            living["y2"]
            - (
                usable_plot["y"]
                + usable_plot["length"]
            )
        ) <= tolerance

        wall = "top"

        wall_length = living["width"]

    # -----------------------------------------------------
    # South
    # -----------------------------------------------------

    elif road == "south":

        touches = abs(
            living["y"]
            - usable_plot["y"]
        ) <= tolerance

        wall = "bottom"

        wall_length = living["width"]

    # -----------------------------------------------------
    # East
    # -----------------------------------------------------

    elif road == "east":

        touches = abs(
            living["x2"]
            - (
                usable_plot["x"]
                + usable_plot["width"]
            )
        ) <= tolerance

        wall = "right"

        wall_length = living["length"]

    # -----------------------------------------------------
    # West
    # -----------------------------------------------------

    elif road == "west":

        touches = abs(
            living["x"]
            - usable_plot["x"]
        ) <= tolerance

        wall = "left"

        wall_length = living["length"]

    else:

        return {
            "valid": False,
            "reason": f"Unsupported road side: {road_side}"
        }

    # -----------------------------------------------------
    # Living room must touch road side
    # -----------------------------------------------------

    if not touches:

        return {
            "valid": False,
            "reason": (
                "Living room does not touch the "
                "road-facing boundary."
            )
        }

    # -----------------------------------------------------
    # Main door
    # -----------------------------------------------------

    width = DOOR_WIDTHS["main"]

    if wall_length < width:

        return {
            "valid": False,
            "reason": (
                "Living room wall is too short "
                "for the main entrance."
            )
        }

    position = (
        (wall_length - width) / 2
    )

    return {
        "valid": True,

        "type": "door",

        "door_type": "main",

        "room": "living_room",

        "wall": wall,

        "width": width,

        "position": round(
            position,
            2
        ),

        "road_side": road_side,

        "description": (
            "Main entrance on the road-facing "
            "side of the living room."
        )
    }


# =========================================================
# COMPLETE SMART DOOR SYSTEM
# =========================================================

def generate_smart_doors(
    rooms: List[Dict],
    usable_plot: Dict,
    road_side: str = "North"
) -> Dict:
    """
    Generate a complete door system using actual
    room-to-room connections.
    """

    errors = []

    # -----------------------------------------------------
    # Internal doors
    # -----------------------------------------------------

    internal_doors = create_smart_internal_doors(
        rooms
    )

    # -----------------------------------------------------
    # Main entrance
    # -----------------------------------------------------

    entrance = create_main_entrance(
        rooms,
        usable_plot,
        road_side
    )

    if not entrance["valid"]:

        errors.append(
            entrance["reason"]
        )

    # -----------------------------------------------------
    # Combine
    # -----------------------------------------------------

    doors = list(
        internal_doors
    )

    if entrance["valid"]:

        doors.insert(
            0,
            entrance
        )

    return {
        "valid": len(errors) == 0,

        "doors": doors,

        "internal_doors": internal_doors,

        "entrance": (
            entrance
            if entrance["valid"]
            else None
        ),

        "errors": errors,

        "connection_count": len(
            internal_doors
        )
    }