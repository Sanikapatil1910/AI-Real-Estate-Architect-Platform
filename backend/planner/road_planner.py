from typing import Dict, List


# =========================================================
# ROAD-AWARE ROOM PLACEMENT
# =========================================================

PUBLIC_ROOMS = {
    "living_room",
    "dining"
}

SERVICE_ROOMS = {
    "kitchen",
    "utility"
}

PRIVATE_ROOMS = {
    "master_bedroom",
    "bedroom",
    "guest_bedroom"
}


# =========================================================
# ROAD DIRECTION
# =========================================================

def get_road_edge(
    usable_plot: Dict,
    road_side: str
) -> float:
    """
    Return the coordinate of the road-facing edge.
    """

    road = road_side.lower()

    if road == "north":
        return (
            usable_plot["y"]
            + usable_plot["length"]
        )

    if road == "south":
        return usable_plot["y"]

    if road == "east":
        return (
            usable_plot["x"]
            + usable_plot["width"]
        )

    if road == "west":
        return usable_plot["x"]

    raise ValueError(
        f"Unsupported road side: {road_side}"
    )


# =========================================================
# DISTANCE FROM ROAD
# =========================================================

def room_distance_from_road(
    room: Dict,
    usable_plot: Dict,
    road_side: str
) -> float:
    """
    Calculate the shortest distance between a room
    and the road-facing boundary.
    """

    road = road_side.lower()

    if road == "north":

        return abs(
            (
                usable_plot["y"]
                + usable_plot["length"]
            )
            - room["y2"]
        )

    if road == "south":

        return abs(
            room["y"]
            - usable_plot["y"]
        )

    if road == "east":

        return abs(
            (
                usable_plot["x"]
                + usable_plot["width"]
            )
            - room["x2"]
        )

    if road == "west":

        return abs(
            room["x"]
            - usable_plot["x"]
        )

    return 9999


# =========================================================
# ROAD-AWARE SCORE
# =========================================================

def calculate_road_score(
    rooms: List[Dict],
    usable_plot: Dict,
    road_side: str
) -> float:
    """
    Score the layout based on how well public rooms
    are positioned near the road.

    Higher = better.
    """

    public_rooms = [
        room
        for room in rooms
        if room["room_type"] in PUBLIC_ROOMS
    ]

    if not public_rooms:

        return 0.0

    distances = []

    max_distance = max(
        usable_plot["width"],
        usable_plot["length"]
    )

    for room in public_rooms:

        distance = room_distance_from_road(
            room,
            usable_plot,
            road_side
        )

        normalized = max(
            0.0,
            1.0 - (
                distance / max_distance
            )
        )

        distances.append(
            normalized * 100
        )

    return round(
        sum(distances) / len(distances),
        2
    )


# =========================================================
# ENTRANCE CANDIDATE
# =========================================================

def find_entrance_room(
    rooms: List[Dict],
    usable_plot: Dict,
    road_side: str
) -> Dict:
    """
    Find the best public room for the entrance.

    Living room gets priority.
    """

    living_rooms = [
        room
        for room in rooms
        if room["room_type"] == "living_room"
    ]

    if living_rooms:

        living = living_rooms[0]

        distance = room_distance_from_road(
            living,
            usable_plot,
            road_side
        )

        return {
            "room_type": "living_room",
            "distance_from_road": round(
                distance,
                2
            ),
            "preferred": True
        }

    # -----------------------------------------------------
    # Fallback to dining
    # -----------------------------------------------------

    dining_rooms = [
        room
        for room in rooms
        if room["room_type"] == "dining"
    ]

    if dining_rooms:

        dining = dining_rooms[0]

        distance = room_distance_from_road(
            dining,
            usable_plot,
            road_side
        )

        return {
            "room_type": "dining",
            "distance_from_road": round(
                distance,
                2
            ),
            "preferred": False
        }

    return {
        "room_type": None,
        "distance_from_road": None,
        "preferred": False
    }


# =========================================================
# ROAD ANALYSIS
# =========================================================

def analyze_road_layout(
    rooms: List[Dict],
    usable_plot: Dict,
    road_side: str = "North"
) -> Dict:
    """
    Analyze whether the layout is suitable for
    road-facing entrance and public-zone placement.
    """

    entrance_room = find_entrance_room(
        rooms,
        usable_plot,
        road_side
    )

    road_score = calculate_road_score(
        rooms,
        usable_plot,
        road_side
    )

    distance = entrance_room[
        "distance_from_road"
    ]

    warnings = []

    if distance is None:

        warnings.append(
            "No suitable public room found for entrance."
        )

    elif distance > 5:

        warnings.append(
            "Public zone is far from the road. "
            "Consider moving the living room closer "
            "to the entrance side."
        )

    return {
        "road_side": road_side,

        "entrance_room": entrance_room,

        "road_score": road_score,

        "warnings": warnings,

        "valid": len(warnings) == 0
    }