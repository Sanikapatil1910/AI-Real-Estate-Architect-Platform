from typing import Dict, List
import math

from backend.planner.style_knowledge import get_style_relationship_weight


# Higher weight = stronger desired relationship
ROOM_RELATIONSHIPS = {
    ("living_room", "dining"): 10,
    ("dining", "kitchen"): 10,
    ("kitchen", "utility"): 10,

    ("living_room", "master_bedroom"): 4,
    ("living_room", "bedroom"): 4,
    ("living_room", "guest_bedroom"): 5,

    ("master_bedroom", "bathroom"): 8,
    ("bedroom", "bathroom"): 7,
    ("guest_bedroom", "bathroom"): 6,

    ("dining", "puja_room"): 5,
}


def room_center(room: Dict):
    """Return the center point of a room."""

    center_x = room["x"] + room["width"] / 2
    center_y = room["y"] + room["length"] / 2

    return center_x, center_y


def distance_between_rooms(
    room_a: Dict,
    room_b: Dict
) -> float:
    """Calculate center-to-center distance between rooms."""

    ax, ay = room_center(room_a)
    bx, by = room_center(room_b)

    return math.sqrt(
        (ax - bx) ** 2 +
        (ay - by) ** 2
    )


def get_relationship_weight(
    room_a: str,
    room_b: str
) -> int:
    """Return relationship strength between two room types."""

    pair = (room_a, room_b)
    reverse_pair = (room_b, room_a)

    if pair in ROOM_RELATIONSHIPS:
        return ROOM_RELATIONSHIPS[pair]

    if reverse_pair in ROOM_RELATIONSHIPS:
        return ROOM_RELATIONSHIPS[reverse_pair]

    return 0


def evaluate_room_relationships(
    rooms: List[Dict],
    style: str = ""
) -> Dict:
    """
    Evaluate how well rooms are positioned relative
    to important functional relationships.
    """

    evaluations = []
    total_score = 0
    maximum_score = 0

    for i in range(len(rooms)):

        for j in range(i + 1, len(rooms)):

            room_a = rooms[i]
            room_b = rooms[j]

            type_a = room_a["room_type"]
            type_b = room_b["room_type"]

            weight = get_relationship_weight(
                type_a,
                type_b
            )
            if style:
                weight = get_style_relationship_weight(style, type_a, type_b, weight)

            # No important relationship
            if weight == 0:
                continue

            distance = distance_between_rooms(
                room_a,
                room_b
            )

            # Closer rooms receive better scores.
            # 1 means excellent, approaching 0 means far away.
            proximity_score = 1 / (1 + distance / 10)

            relationship_score = (
                weight * proximity_score
            )

            total_score += relationship_score
            maximum_score += weight

            evaluations.append({
                "room_a": type_a,
                "room_b": type_b,
                "distance": round(distance, 2),
                "relationship_weight": weight,
                "proximity_score": round(
                    proximity_score,
                    3
                ),
                "score": round(
                    relationship_score,
                    2
                )
            })

    if maximum_score > 0:
        overall_score = (
            total_score / maximum_score
        ) * 100
    else:
        overall_score = 100

    return {
        "overall_score": round(
            overall_score,
            2
        ),
        "evaluations": evaluations
    }