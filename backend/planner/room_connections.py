from typing import Dict, List, Optional


# =========================================================
# REQUIRED ROOM CONNECTIONS
# =========================================================

REQUIRED_CONNECTIONS = [
    ("living_room", "dining"),
    ("dining", "kitchen"),
    ("kitchen", "utility"),
    ("master_bedroom", "bathroom"),
]


# =========================================================
# HELPER FUNCTIONS
# =========================================================

def normalize_pair(room_a: str, room_b: str):
    """
    Store a room pair in a consistent order.
    """

    return tuple(sorted([room_a, room_b]))


def get_room_by_type(
    rooms: List[Dict],
    room_type: str
) -> Optional[Dict]:
    """
    Find a room by its room_type.
    """

    for room in rooms:

        if room["room_type"] == room_type:
            return room

    return None


# =========================================================
# SHARED WALL DETECTION
# =========================================================

def get_shared_wall(
    room_a: Dict,
    room_b: Dict,
    tolerance: float = 0.01
) -> Optional[Dict]:
    """
    Determine whether two rectangular rooms share a wall.

    Returns:
        {
            "wall_a": ...,
            "wall_b": ...,
            "length": ...,
            "start": ...,
            "end": ...
        }

    or None if they do not share a wall.
    """

    # -----------------------------------------------------
    # A's right wall touches B's left wall
    # -----------------------------------------------------

    if abs(room_a["x2"] - room_b["x"]) <= tolerance:

        overlap_start = max(
            room_a["y"],
            room_b["y"]
        )

        overlap_end = min(
            room_a["y2"],
            room_b["y2"]
        )

        if overlap_end > overlap_start:

            return {
                "wall_a": "right",
                "wall_b": "left",
                "length": round(
                    overlap_end - overlap_start,
                    2
                ),
                "start": round(
                    overlap_start,
                    2
                ),
                "end": round(
                    overlap_end,
                    2
                )
            }

    # -----------------------------------------------------
    # A's left wall touches B's right wall
    # -----------------------------------------------------

    if abs(room_a["x"] - room_b["x2"]) <= tolerance:

        overlap_start = max(
            room_a["y"],
            room_b["y"]
        )

        overlap_end = min(
            room_a["y2"],
            room_b["y2"]
        )

        if overlap_end > overlap_start:

            return {
                "wall_a": "left",
                "wall_b": "right",
                "length": round(
                    overlap_end - overlap_start,
                    2
                ),
                "start": round(
                    overlap_start,
                    2
                ),
                "end": round(
                    overlap_end,
                    2
                )
            }

    # -----------------------------------------------------
    # A's top wall touches B's bottom wall
    # -----------------------------------------------------

    if abs(room_a["y2"] - room_b["y"]) <= tolerance:

        overlap_start = max(
            room_a["x"],
            room_b["x"]
        )

        overlap_end = min(
            room_a["x2"],
            room_b["x2"]
        )

        if overlap_end > overlap_start:

            return {
                "wall_a": "top",
                "wall_b": "bottom",
                "length": round(
                    overlap_end - overlap_start,
                    2
                ),
                "start": round(
                    overlap_start,
                    2
                ),
                "end": round(
                    overlap_end,
                    2
                )
            }

    # -----------------------------------------------------
    # A's bottom wall touches B's top wall
    # -----------------------------------------------------

    if abs(room_a["y"] - room_b["y2"]) <= tolerance:

        overlap_start = max(
            room_a["x"],
            room_b["x"]
        )

        overlap_end = min(
            room_a["x2"],
            room_b["x2"]
        )

        if overlap_end > overlap_start:

            return {
                "wall_a": "bottom",
                "wall_b": "top",
                "length": round(
                    overlap_end - overlap_start,
                    2
                ),
                "start": round(
                    overlap_start,
                    2
                ),
                "end": round(
                    overlap_end,
                    2
                )
            }

    return None


# =========================================================
# DOOR POSITION
# =========================================================

def calculate_door_position(
    shared_wall: Dict,
    door_width: float = 3.0
) -> Optional[float]:
    """
    Calculate a centered door position on a shared wall.
    """

    wall_length = shared_wall["length"]

    if wall_length < door_width:

        return None

    position = (
        shared_wall["start"]
        + (wall_length - door_width) / 2
    )

    return round(position, 2)


# =========================================================
# CREATE ROOM CONNECTION
# =========================================================

def create_connection(
    room_a: Dict,
    room_b: Dict
) -> Dict:
    """
    Create a connection between two rooms if they
    physically share a wall.
    """

    shared_wall = get_shared_wall(
        room_a,
        room_b
    )

    if shared_wall is None:

        return {
            "connected": False,
            "room_a": room_a["room_type"],
            "room_b": room_b["room_type"],
            "reason": "Rooms do not share a wall."
        }

    # Bathroom doors can be smaller.
    if (
        room_a["room_type"] == "bathroom"
        or room_b["room_type"] == "bathroom"
    ):
        door_width = 2.5

    else:
        door_width = 3.0

    position = calculate_door_position(
        shared_wall,
        door_width
    )

    if position is None:

        return {
            "connected": False,
            "room_a": room_a["room_type"],
            "room_b": room_b["room_type"],
            "reason": "Shared wall is too short for a door."
        }

    return {
        "connected": True,

        "room_a": room_a["room_type"],
        "room_b": room_b["room_type"],

        "wall_a": shared_wall["wall_a"],
        "wall_b": shared_wall["wall_b"],

        "shared_wall_length": shared_wall["length"],

        "door": {
            "width": door_width,
            "position": position
        }
    }


# =========================================================
# FIND ALL PHYSICAL CONNECTIONS
# =========================================================

def find_all_connections(
    rooms: List[Dict]
) -> List[Dict]:
    """
    Find every pair of rooms that physically share
    a wall.
    """

    connections = []

    for i in range(len(rooms)):

        for j in range(i + 1, len(rooms)):

            room_a = rooms[i]
            room_b = rooms[j]

            connection = create_connection(
                room_a,
                room_b
            )

            if connection["connected"]:

                connections.append(
                    connection
                )

    return connections


# =========================================================
# CHECK REQUIRED CONNECTIONS
# =========================================================

def check_required_connections(
    rooms: List[Dict]
) -> Dict:
    """
    Check whether important architectural relationships
    are physically connected.
    """

    results = []
    missing = []

    for room_a_type, room_b_type in REQUIRED_CONNECTIONS:

        room_a = get_room_by_type(
            rooms,
            room_a_type
        )

        room_b = get_room_by_type(
            rooms,
            room_b_type
        )

        # -----------------------------------------------
        # One of the rooms may not exist.
        # -----------------------------------------------

        if room_a is None or room_b is None:

            # Kitchen-utility is optional if utility
            # wasn't requested.
            if room_a_type == "kitchen" and room_b_type == "utility":

                continue

            results.append({
                "rooms": [
                    room_a_type,
                    room_b_type
                ],
                "connected": False,
                "reason": "Required room is missing."
            })

            missing.append(
                normalize_pair(
                    room_a_type,
                    room_b_type
                )
            )

            continue

        connection = create_connection(
            room_a,
            room_b
        )

        results.append(
            connection
        )

        if not connection["connected"]:

            missing.append(
                normalize_pair(
                    room_a_type,
                    room_b_type
                )
            )

    return {
        "valid": len(missing) == 0,
        "results": results,
        "missing_connections": missing
    }


# =========================================================
# CIRCULATION GRAPH
# =========================================================

def build_circulation_graph(
    rooms: List[Dict]
) -> Dict:
    """
    Build a simple graph representing physical
    room-to-room circulation.

    Example:

    living_room
         |
       dining
         |
      kitchen
    """

    connections = find_all_connections(
        rooms
    )

    graph = {}

    for room in rooms:

        graph[
            room["room_type"]
        ] = []

    for connection in connections:

        room_a = connection["room_a"]
        room_b = connection["room_b"]

        graph[room_a].append(
            room_b
        )

        graph[room_b].append(
            room_a
        )

    return graph


# =========================================================
# FULL ROOM CONNECTION ANALYSIS
# =========================================================

def analyze_room_connections(
    rooms: List[Dict]
) -> Dict:
    """
    Perform complete room connection analysis.
    """

    all_connections = find_all_connections(
        rooms
    )

    required = check_required_connections(
        rooms
    )

    graph = build_circulation_graph(
        rooms
    )

    return {
        "valid": required["valid"],

        "all_connections": all_connections,

        "required_connections": required,

        "circulation_graph": graph
    }