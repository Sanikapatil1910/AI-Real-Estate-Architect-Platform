from typing import Dict, List

from backend.planner.climate_knowledge import get_climate_profile
from backend.planner.plot_rules import normalize_road_side
from backend.planner.room_connections import (
    build_circulation_graph,
    get_shared_wall,
)


# ---------------------------------------------------------
# Default sizes
# ---------------------------------------------------------

DEFAULT_DOOR_WIDTHS = {
    "main": 4.0,
    "bedroom": 3.0,
    "bathroom": 2.5,
    "utility": 2.5,
    "puja_room": 2.5,
    "internal": 3.0
}


DEFAULT_WINDOW_WIDTHS = {
    "living_room": 5.0,
    "dining": 4.0,
    "kitchen": 4.0,
    "master_bedroom": 5.0,
    "bedroom": 4.0,
    "guest_bedroom": 4.0,
    "bathroom": 2.0,
    "utility": 3.0,
    "puja_room": 2.0
}

REQUIRED_CONNECTIONS = [
    ("living_room", "dining"),
    ("dining", "kitchen"),
    ("kitchen", "utility"),
    ("master_bedroom", "bathroom"),
]


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------

def get_room(
    rooms: List[Dict],
    room_type: str
):
    """
    Return the first room matching room_type.
    """

    for room in rooms:

        if room["room_type"] == room_type:
            return room

    return None


def room_touches_boundary(
    room: Dict,
    usable_plot: Dict,
    tolerance: float = 0.01
) -> Dict:
    """
    Determine which sides of the room touch the
    usable construction boundary.
    """

    left = abs(
        room["x"] - usable_plot["x"]
    ) <= tolerance

    right = abs(
        room["x2"]
        - (
            usable_plot["x"]
            + usable_plot["width"]
        )
    ) <= tolerance

    # Screen convention: y grows downward, so "top" is the small-y edge
    # (north when north is up) and "bottom" is the large-y edge.
    top = abs(
        room["y"] - usable_plot["y"]
    ) <= tolerance

    bottom = abs(
        room["y2"]
        - (
            usable_plot["y"]
            + usable_plot["length"]
        )
    ) <= tolerance

    return {
        "left": left,
        "right": right,
        "bottom": bottom,
        "top": top
    }


def opening_position(
    room: Dict,
    wall: str,
    width: float
) -> Dict:
    """
    Create a position along a room wall.

    position is measured from the lower/left corner
    of the corresponding wall.
    """

    if wall in {"left", "right"}:

        wall_length = room["length"]

    else:

        wall_length = room["width"]

    # Keep opening away from corners.
    position = max(
        1.0,
        (wall_length - width) / 2
    )

    return {
        "position": round(position, 2),
        "wall_length": round(wall_length, 2)
    }


def calculate_door_position(shared_wall: Dict, door_width: float) -> float:
    return round(
        shared_wall["start"]
        + max(0.25, (shared_wall["length"] - door_width) / 2),
        2,
    )


# ---------------------------------------------------------
# Main entrance
# ---------------------------------------------------------

def create_main_entrance(
    rooms: List[Dict],
    usable_plot: Dict,
    road_side: str = "North"
) -> Dict:
    """
    Create the main entrance on the road-facing side.

    Living room is preferred because it is the public
    zone of the house.
    """

    road = normalize_road_side(road_side).lower()
    wall_for_road = {
        "north": "top",
        "south": "bottom",
        "east": "right",
        "west": "left",
    }.get(road)
    public_rooms = [
        room for room in rooms
        if room["room_type"] in {"living_room", "foyer", "dining"}
    ]
    living = get_room(rooms, "living_room")
    candidates = ([living] if living else []) + [
        room for room in public_rooms if room is not living
    ]
    entry_room = next(
        (
            room for room in candidates
            if wall_for_road
            and room_touches_boundary(room, usable_plot)[wall_for_road]
        ),
        None,
    )

    if entry_room is None:

        return {
            "valid": False,
            "error": "A public room must touch the road-facing boundary for the main entrance."
        }

    # -----------------------------------------------------
    # North
    # -----------------------------------------------------

    if road == "north":

        wall = "top"

        opening = opening_position(
            entry_room,
            wall,
            DEFAULT_DOOR_WIDTHS["main"]
        )

    # -----------------------------------------------------
    # South
    # -----------------------------------------------------

    elif road == "south":

        wall = "bottom"

        opening = opening_position(
            entry_room,
            wall,
            DEFAULT_DOOR_WIDTHS["main"]
        )

    # -----------------------------------------------------
    # East
    # -----------------------------------------------------

    elif road == "east":

        wall = "right"

        opening = opening_position(
            entry_room,
            wall,
            DEFAULT_DOOR_WIDTHS["main"]
        )

    # -----------------------------------------------------
    # West
    # -----------------------------------------------------

    elif road == "west":

        wall = "left"

        opening = opening_position(
            entry_room,
            wall,
            DEFAULT_DOOR_WIDTHS["main"]
        )

    else:

        return {
            "valid": False,
            "error": f"Unsupported road side: {road_side}"
        }

    return {
        "valid": True,
        "type": "door",
        "door_type": "main",
        "room": entry_room["room_type"],
        "wall": wall,
        "width": DEFAULT_DOOR_WIDTHS["main"],
        "position": opening["position"],
        "description": "Main entrance facing the road."
    }


# ---------------------------------------------------------
# Internal doors
# ---------------------------------------------------------

def create_internal_doors(
    rooms: List[Dict]
) -> List[Dict]:
    """
    Create simple internal doors.

    The first suitable wall is selected.
    Later we can improve this using actual
    room-to-room adjacency.
    """

    doors = []
    seen_pairs = set()
    preferred_pairs = REQUIRED_CONNECTIONS + [
        ("living_room", "guest_bedroom"),
        ("living_room", "master_bedroom"),
        ("living_room", "bedroom"),
        ("bedroom", "bathroom"),
        ("guest_bedroom", "bathroom"),
    ]
    for bathroom in (room for room in rooms if room.get("room_type") == "bathroom"):
        attached_to = bathroom.get("attached_to")
        if not attached_to:
            continue
        attached_room = next(
            (room for room in rooms if room.get("room_type") == attached_to),
            None,
        )
        shared_wall = get_shared_wall(attached_room, bathroom) if attached_room else None
        if not shared_wall:
            continue
        door_width = min(
            DEFAULT_DOOR_WIDTHS["bathroom"],
            max(1.0, shared_wall["length"] - 0.5),
        )
        doors.append({
            "type": "door",
            "door_type": "internal",
            "room": attached_to,
            "connects_to": "bathroom",
            "wall": shared_wall["wall_a"],
            "width": door_width,
            "position": calculate_door_position(shared_wall, door_width),
            "shared_wall_length": shared_wall["length"],
        })
        seen_pairs.add(tuple(sorted((attached_to, "bathroom"))))
    for first_type, second_type in preferred_pairs:
        first = get_room(rooms, first_type)
        second = get_room(rooms, second_type)
        if not first or not second:
            continue
        pair = tuple(sorted((first_type, second_type)))
        if pair in seen_pairs:
            continue
        shared_wall = get_shared_wall(first, second)
        if not shared_wall:
            continue
        seen_pairs.add(pair)
        door_width = DEFAULT_DOOR_WIDTHS.get(
            second_type,
            DEFAULT_DOOR_WIDTHS["internal"],
        )
        door_width = min(
            door_width,
            max(1.0, shared_wall["length"] - 0.5),
        )
        doors.append({
            "type": "door",
            "door_type": "internal",
            "room": first_type,
            "connects_to": second_type,
            "wall": shared_wall["wall_a"],
            "width": door_width,
            "position": calculate_door_position(
                shared_wall,
                door_width,
            ),
            "shared_wall_length": shared_wall["length"],
        })

    return doors


# ---------------------------------------------------------
# Windows
# ---------------------------------------------------------

def create_windows(
    rooms: List[Dict],
    usable_plot: Dict,
    climate: str = "Auto",
) -> List[Dict]:
    """
    Create exterior-facing windows.

    Windows are only placed on walls that touch the
    exterior usable-plot boundary.
    """

    windows = []

    for room in rooms:

        room_type = room["room_type"]

        window_width = DEFAULT_WINDOW_WIDTHS.get(
            room_type,
            3.0
        )
        opening_preference = get_climate_profile(climate)["opening_preference"]
        if "large" in opening_preference or "generous" in opening_preference:
            window_width *= 1.15
        elif "controlled" in opening_preference or "moderate" in opening_preference:
            window_width *= 0.95
        window_width = round(window_width, 2)

        boundaries = room_touches_boundary(
            room,
            usable_plot
        )

        # -------------------------------------------------
        # Select exterior wall
        # -------------------------------------------------

        wall = None

        if boundaries["top"]:
            wall = "top"

        elif boundaries["right"]:
            wall = "right"

        elif boundaries["left"]:
            wall = "left"

        elif boundaries["bottom"]:
            wall = "bottom"

        # No exterior wall
        if wall is None:
            continue

        opening = opening_position(
            room,
            wall,
            window_width
        )

        windows.append({
            "type": "window",
            "room": room_type,
            "wall": wall,
            "width": window_width,
            "position": opening["position"]
        })

    return windows


# ---------------------------------------------------------
# Complete openings generator
# ---------------------------------------------------------

def generate_openings(
    rooms: List[Dict],
    usable_plot: Dict,
    road_side: str = "North",
    climate: str = "Auto",
) -> Dict:
    """
    Generate doors and windows for the layout.
    """

    errors = []

    # -----------------------------------------------------
    # Main entrance
    # -----------------------------------------------------

    main_entrance = create_main_entrance(
        rooms,
        usable_plot,
        road_side
    )

    if not main_entrance["valid"]:

        errors.append(
            main_entrance["error"]
        )

    # -----------------------------------------------------
    # Internal doors
    # -----------------------------------------------------

    internal_doors = create_internal_doors(
        rooms
    )
    circulation_graph = build_circulation_graph(rooms)
    entry_room = main_entrance.get("room") if main_entrance["valid"] else None
    reachable_rooms = set()
    pending = [entry_room] if entry_room else []
    while pending:
        current = pending.pop()
        if current in reachable_rooms:
            continue
        reachable_rooms.add(current)
        pending.extend(circulation_graph.get(current, []))

    # -----------------------------------------------------
    # Windows
    # -----------------------------------------------------

    windows = create_windows(
        rooms,
        usable_plot,
        climate,
    )

    # -----------------------------------------------------
    # Combine doors
    # -----------------------------------------------------

    doors = []

    if main_entrance["valid"]:

        doors.append(
            main_entrance
        )

    doors.extend(
        internal_doors
    )

    return {
        "valid": len(errors) == 0,

        "doors": doors,

        "windows": windows,

        "entrance": (
            main_entrance
            if main_entrance["valid"]
            else None
        ),
        "circulation": {
            "graph": circulation_graph,
            "entry_room": entry_room,
            "reachable_rooms": sorted(reachable_rooms),
            "connected": bool(entry_room)
            and len(reachable_rooms) == len(rooms),
            "door_count": len(internal_doors),
        },

        "errors": errors,
        "climate": get_climate_profile(climate)["climate_name"],
        "opening_strategy": get_climate_profile(climate)["opening_preference"],
        "shading_preference": get_climate_profile(climate)["shading_preference"],
    }