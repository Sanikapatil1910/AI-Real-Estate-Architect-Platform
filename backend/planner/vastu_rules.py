from typing import Dict, List

from knowledge.vastu.vastu_knowledge import get_rules_for_room


# ---------------------------------------------------------
# DIRECTION CALCULATION
# ---------------------------------------------------------

def get_zone(
    x: float,
    y: float,
    plot_width: float,
    plot_length: float,
    origin_x: float = 0,
    origin_y: float = 0,
) -> str:
    """
    Determine the 8-direction Vastu zone of a point.

    Coordinate system:

              NORTH
                ↑
        NW      N      NE

        W       C       E

        SW      S      SE
                ↓
              SOUTH
    """

    # Divide the plot into 3 vertical and 3 horizontal zones.
    vertical_zone = ""

    horizontal_zone = ""

    # X direction
    relative_x = x - origin_x
    relative_y = y - origin_y

    if relative_x < plot_width / 3:
        horizontal_zone = "west"

    elif relative_x > (plot_width * 2 / 3):
        horizontal_zone = "east"

    else:
        horizontal_zone = "center"

    # Y direction. Screen convention used everywhere (renderers, openings,
    # digital twin): y grows downward, so NORTH is the small-y edge.
    if relative_y < plot_length / 3:
        vertical_zone = "north"

    elif relative_y > (plot_length * 2 / 3):
        vertical_zone = "south"

    else:
        vertical_zone = "center"

    # Combine directions
    if vertical_zone == "center" and horizontal_zone == "center":
        return "center"

    if vertical_zone == "center":
        return horizontal_zone

    if horizontal_zone == "center":
        return vertical_zone

    return f"{vertical_zone}_{horizontal_zone}"


# ---------------------------------------------------------
# ROOM CENTER
# ---------------------------------------------------------

def get_room_zone(
    room: Dict,
    plot_width: float,
    plot_length: float,
    origin_x: float = 0,
    origin_y: float = 0,
) -> str:
    """
    Find the Vastu zone using the center of the room.
    """

    center_x = room["x"] + room["width"] / 2
    center_y = room["y"] + room["length"] / 2

    return get_zone(
        x=center_x,
        y=center_y,
        plot_width=plot_width, plot_length=plot_length,
        origin_x=origin_x, origin_y=origin_y,
    )


# ---------------------------------------------------------
# SCORE ONE ROOM
# ---------------------------------------------------------

def score_room_vastu(
    room: Dict,
    plot_width: float,
    plot_length: float,
    mode: str = "basic",
    origin_x: float = 0,
    origin_y: float = 0,
) -> Dict:
    """
    Score a room according to its Vastu zone.

    Modes:
        no_preference
        basic
        strict
    """

    mode = mode.lower().replace("-", "_").replace(" ", "_")

    room_type = room["room_type"]

    # No Vastu preference
    if mode == "no_preference":
        return {
            "room_type": room_type,
            "zone": get_room_zone(
                room,
                plot_width,
                plot_length,
                origin_x,
                origin_y,
            ),
            "score": 100,
            "status": "ignored",
            "reason": "Vastu preference disabled."
        }

    zone = get_room_zone(room, plot_width, plot_length, origin_x, origin_y)
    rules = [rule for rule in get_rules_for_room(room_type)
             if rule["zone_normalized"] != "any" and rule["category_normalized"] != "vastu matrix"]
    matching_rules = [rule for rule in rules
                      if zone.replace("_", " ") in rule["zone_normalized"].replace("/", " ").split()
                      or zone.replace("_", "") in rule["zone_normalized"].replace("/", " ").replace(" ", "")]

    if not rules:
        return {
            "room_type": room_type, "zone": zone, "score": 50,
            "status": "neutral", "reason": "No Vastu rule defined for this room.",
            "rules": [], "explanations": [], "hard_constraint_violations": [],
        }

    rule = matching_rules[0] if matching_rules else None
    preference = rule["preference"] if rule else "Neutral"
    preference_key = str(preference).lower()
    scores = {
        "highly preferred": 100,
        "preferred": 90,
        "allowed": 75,
        "conditional": 65,
        "adaptive": 65,
        "evaluate": 65,
        "optional": 60,
        "important": 80,
        "avoid": 25 if mode == "basic" else 0,
        "required": 80,
        "feasible": 70,
        "soft constraint": 60,
    }
    score = scores.get(preference_key, 60) if rule else 60
    hard_violation = bool(rule and rule["hard_constraint_bool"] and preference_key == "avoid")
    explanation = (rule["rule"] if rule else "No matching Vastu guidance was found.")

    return {
        "room_type": room_type, "zone": zone, "score": score,
        "status": preference_key.replace(" ", "_"),
        "reason": "Traditional Vastu preference from the knowledge base.",
        "preference": preference, "rule_id": rule["rule_id"] if rule else None,
        "rule": explanation, "notes": rule["notes"] if rule else "",
        "hard_constraint": rule["hard_constraint"] if rule else "NO",
        "hard_constraint_violation": hard_violation,
    }


# ---------------------------------------------------------
# SCORE COMPLETE LAYOUT
# ---------------------------------------------------------

def evaluate_vastu(
    rooms: List[Dict],
    plot_width: float,
    plot_length: float,
    mode: str = "basic",
    origin_x: float = 0,
    origin_y: float = 0,
) -> Dict:
    """
    Evaluate the complete floor plan for Vastu.
    """

    mode = mode.lower().replace("-", "_").replace(" ", "_")
    if mode not in {
        "no_preference",
        "basic",
        "strict"
    }:
        return {
            "valid": False,
            "error": (
                "Vastu mode must be "
                "'no_preference', 'basic' or 'strict'."
            )
        }

    room_scores = []

    for room in rooms:

        score = score_room_vastu(
            room=room,
            plot_width=plot_width,
            plot_length=plot_length,
            mode=mode,
            origin_x=origin_x,
            origin_y=origin_y,
        )

        room_scores.append(score)

    hard_constraint_violations = [item for item in room_scores if item.get("hard_constraint_violation")]

    if mode == "no_preference":

        overall_score = 100

    elif room_scores:

        overall_score = sum(
            item["score"]
            for item in room_scores
        ) / len(room_scores)

    else:

        overall_score = 100

    return {
        "valid": not hard_constraint_violations,
        "mode": mode,
        "overall_score": round(
            overall_score,
            2
        ),
        "rooms": room_scores,
        "room_scores": room_scores,
        "violations": [item for item in room_scores if item.get("status") == "avoid"],
        "preferences_satisfied": [item for item in room_scores if item.get("status") in {"preferred", "highly_preferred"}],
        "hard_constraint_violations": hard_constraint_violations,
        "explanations": [item for item in room_scores if item.get("rule")],
    }