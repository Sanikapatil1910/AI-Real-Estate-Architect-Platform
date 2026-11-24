from copy import deepcopy

from backend.planner.staircase_engine import (
    calculate_staircase_for_building,
)


# Default staircase room size.
# These are planning dimensions in feet.
DEFAULT_STAIRCASE_ROOM_WIDTH = 7.0
DEFAULT_STAIRCASE_ROOM_LENGTH = 15.0


def add_staircase_requirement(
    rooms,
    building_type="Ground",
    floor_height=10,
    stair_width=3.5,
):
    """
    Add staircase information to the room requirements.

    Staircase is required only when the building has
    more than one floor.

    Ground:
        No staircase required.

    G+1 / Duplex:
        1 floor connection.

    G+2 / Villa:
        2 floor connections.
    """

    updated_rooms = deepcopy(rooms)

    staircase_info = calculate_staircase_for_building(
        building_type=building_type,
        floor_height=floor_height,
        stair_width=stair_width,
    )

    floor_connections = staircase_info["floor_connections"]

    staircase_required = floor_connections > 0

    if staircase_required:
        updated_rooms.append(
            {
                "room_type": "staircase",
                "width": DEFAULT_STAIRCASE_ROOM_WIDTH,
                "length": DEFAULT_STAIRCASE_ROOM_LENGTH,
                "area": (
                    DEFAULT_STAIRCASE_ROOM_WIDTH
                    * DEFAULT_STAIRCASE_ROOM_LENGTH
                ),
            }
        )

    return {
        "rooms": updated_rooms,
        "staircase_required": staircase_required,
        "staircase": staircase_info,
    }


def integrate_staircase(
    rooms,
    building_type="Ground",
    floor_height=10,
    stair_width=3.5,
):
    """
    Complete staircase integration.

    Returns:
        rooms
        staircase information
        staircase requirement status
    """

    result = add_staircase_requirement(
        rooms=rooms,
        building_type=building_type,
        floor_height=floor_height,
        stair_width=stair_width,
    )

    return result