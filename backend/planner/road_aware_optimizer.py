from copy import deepcopy

from backend.planner.layout_optimizer import (
    TOPOLOGY_PROFILES,
    generate_zone_layout,
)


PUBLIC_ROOMS = {
    "living_room",
    "dining"
}


def add_coordinates(room):
    """
    Make sure a room has x, y, x2, y2 coordinates.
    """

    room = deepcopy(room)

    if "x" not in room:
        room["x"] = 0

    if "y" not in room:
        room["y"] = 0

    room["x2"] = room["x"] + room["width"]
    room["y2"] = room["y"] + room["length"]

    return room


def get_road_distance(room, usable_plot, road_side):
    """
    Calculate distance from a room to the road-facing boundary.
    """

    room = add_coordinates(room)

    plot_x = usable_plot["x"]
    plot_y = usable_plot["y"]
    plot_width = usable_plot["width"]
    plot_length = usable_plot["length"]

    road_side = road_side.lower()

    if road_side == "north":
        return (
            plot_y
            + plot_length
            - room["y2"]
        )

    if road_side == "south":
        return room["y"] - plot_y

    if road_side == "east":
        return (
            plot_x
            + plot_width
            - room["x2"]
        )

    if road_side == "west":
        return room["x"] - plot_x

    return 999


def move_room_towards_road(room, usable_plot, road_side):
    """
    Place a room directly against the road-facing boundary.
    """

    room = deepcopy(room)

    plot_x = usable_plot["x"]
    plot_y = usable_plot["y"]
    plot_width = usable_plot["width"]
    plot_length = usable_plot["length"]

    road_side = road_side.lower()

    room["x"] = plot_x
    room["y"] = plot_y

    if road_side == "north":
        room["y"] = (
            plot_y
            + plot_length
            - room["length"]
        )

    elif road_side == "south":
        room["y"] = plot_y

    elif road_side == "east":
        room["x"] = (
            plot_x
            + plot_width
            - room["width"]
        )

    elif road_side == "west":
        room["x"] = plot_x

    room["x2"] = room["x"] + room["width"]
    room["y2"] = room["y"] + room["length"]

    return room


def rectangles_overlap(a, b):
    """
    Check whether two rooms overlap.
    """

    a = add_coordinates(a)
    b = add_coordinates(b)

    return not (
        a["x2"] <= b["x"]
        or b["x2"] <= a["x"]
        or a["y2"] <= b["y"]
        or b["y2"] <= a["y"]
    )


def is_valid_position(room, rooms, usable_plot):
    """
    Check plot boundary and room overlap.
    """

    room = add_coordinates(room)

    if room["x"] < usable_plot["x"]:
        return False

    if room["y"] < usable_plot["y"]:
        return False

    if room["x2"] > (
        usable_plot["x"]
        + usable_plot["width"]
    ):
        return False

    if room["y2"] > (
        usable_plot["y"]
        + usable_plot["length"]
    ):
        return False

    for other in rooms:

        if rectangles_overlap(room, other):
            return False

    return True


def road_aware_layout(
    usable_plot,
    rooms,
    road_side="North",
    strategy="balanced",
    vastu_mode="no_preference"
):
    """
    Generate a layout where public rooms
    are positioned toward the road-facing side.
    """

    layout = generate_zone_layout(
        usable_plot=usable_plot,
        rooms=rooms,
        road_side=road_side,
        strategy=strategy,
        vastu_mode=str(vastu_mode or "no_preference").strip().lower().replace(" ", "_"),
    )

    road_distances = [
        get_road_distance(room, usable_plot, road_side)
        for room in layout["rooms"]
        if room["room_type"] in PUBLIC_ROOMS
    ]
    average_distance = (
        sum(road_distances) / len(road_distances)
        if road_distances else None
    )
    max_distance = max(usable_plot["width"], usable_plot["length"])
    road_score = max(
        0,
        100 - (average_distance / max_distance * 100)
        if average_distance is not None and max_distance
        else 100
    )
    layout["road_side"] = road_side
    layout["average_public_zone_distance"] = round(
        average_distance, 2
    ) if average_distance is not None else None
    layout["road_score"] = round(road_score, 2)
    return layout

    # -------------------------------------------------
    # STEP 1: Separate public and private/service rooms
    # -------------------------------------------------

    public_rooms = [
        room
        for room in rooms
        if room["room_type"] in PUBLIC_ROOMS
    ]

    other_rooms = [
        room
        for room in rooms
        if room["room_type"] not in PUBLIC_ROOMS
    ]

    # -------------------------------------------------
    # STEP 2: Place public rooms toward road
    # -------------------------------------------------

    for room in public_rooms:

        room_copy = deepcopy(room)

        road_room = move_room_towards_road(
            room_copy,
            usable_plot,
            road_side
        )

        use_road_anchor = True

        if use_road_anchor and is_valid_position(
            road_room,
            optimized_rooms,
            usable_plot
        ):

            optimized_rooms.append(road_room)

        else:

            position = find_best_position(
                room_copy,
                usable_plot,
                optimized_rooms,
                road_side,
                strategy
            )

            if position is None:

                return {
                    "valid": False,
                    "rooms": optimized_rooms,
                    "errors": [
                        f"Could not place "
                        f"{room_copy['room_type']}."
                    ]
                }

            room_copy["x"] = position["position"][0]
            room_copy["y"] = position["position"][1]

            room_copy = add_coordinates(
                room_copy
            )

            optimized_rooms.append(
                room_copy
            )

    # -------------------------------------------------
    # STEP 3: Place remaining rooms
    # -------------------------------------------------

    for room in other_rooms:

        room_copy = deepcopy(room)

        position = find_best_position(
            room_copy,
            usable_plot,
            optimized_rooms,
            road_side,
            strategy
        )

        if position is None:

            return {
                "valid": False,
                "rooms": optimized_rooms,
                "errors": [
                    f"Could not place "
                    f"{room_copy['room_type']}."
                ]
            }

        room_copy["x"] = position["position"][0]
        room_copy["y"] = position["position"][1]

        room_copy = add_coordinates(
            room_copy
        )

        optimized_rooms.append(
            room_copy
        )

    # -------------------------------------------------
    # STEP 4: Calculate road score
    # -------------------------------------------------

    road_distances = []

    for room in optimized_rooms:

        if room["room_type"] in PUBLIC_ROOMS:

            distance = get_road_distance(
                room,
                usable_plot,
                road_side
            )

            road_distances.append(
                distance
            )

    if road_distances:

        average_distance = (
            sum(road_distances)
            / len(road_distances)
        )

        max_distance = max(
            usable_plot["width"],
            usable_plot["length"]
        )

        road_score = max(
            0,
            100
            - (
                average_distance
                / max_distance
                * 100
            )
        )

    else:

        average_distance = None
        road_score = 100

    # -------------------------------------------------
    # STEP 5: Calculate area
    # -------------------------------------------------

    used_area = sum(
        room["width"] * room["length"]
        for room in optimized_rooms
    )

    plot_area = (
        usable_plot["width"]
        * usable_plot["length"]
    )

    remaining_area = (
        plot_area - used_area
    )

    # -------------------------------------------------
    # STEP 6: Return result
    # -------------------------------------------------

    return {
        "valid": True,
        "rooms": optimized_rooms,
        "road_side": road_side,
        "average_public_zone_distance": round(
            average_distance,
            2
        ) if average_distance is not None else None,
        "road_score": round(
            road_score,
            2
        ),
        "used_room_area": used_area,
        "remaining_area": remaining_area,
        "errors": []
    }