from typing import Dict, List, Tuple


# ---------------------------------------------------------
# Room categories
# ---------------------------------------------------------

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

WET_ROOMS = {
    "bathroom"
}

SPECIAL_ROOMS = {
    "puja_room"
}


# ---------------------------------------------------------
# Room priority
# ---------------------------------------------------------

ROOM_PRIORITY = {
    "living_room": 1,
    "dining": 2,
    "kitchen": 3,
    "utility": 4,
    "master_bedroom": 5,
    "bedroom": 6,
    "guest_bedroom": 7,
    "bathroom": 8,
    "puja_room": 9
}


# ---------------------------------------------------------
# Utility functions
# ---------------------------------------------------------

def room_area(room: Dict) -> float:
    return room["width"] * room["length"]


def room_center(room: Dict) -> Tuple[float, float]:
    return (
        room["x"] + room["width"] / 2,
        room["y"] + room["length"] / 2
    )


def make_room(
    room_type: str,
    width: float,
    length: float,
    x: float,
    y: float
) -> Dict:

    return {
        "room_type": room_type,
        "width": float(width),
        "length": float(length),
        "x": float(x),
        "y": float(y),
        "x2": float(x + width),
        "y2": float(y + length),
        "area": round(width * length, 2)
    }


def get_room(
    rooms: List[Dict],
    room_type: str
):
    for room in rooms:
        if room["room_type"] == room_type:
            return room

    return None


# ---------------------------------------------------------
# Check whether a rectangle is free
# ---------------------------------------------------------

def rectangles_overlap(
    x: float,
    y: float,
    width: float,
    length: float,
    rooms: List[Dict]
) -> bool:

    x2 = x + width
    y2 = y + length

    for room in rooms:

        separated = (
            x2 <= room["x"]
            or room["x2"] <= x
            or y2 <= room["y"]
            or room["y2"] <= y
        )

        if not separated:
            return True

    return False


def fits_inside(
    x: float,
    y: float,
    width: float,
    length: float,
    usable_plot: Dict
) -> bool:

    return (
        x >= usable_plot["x"]
        and y >= usable_plot["y"]
        and x + width <= usable_plot["x"] + usable_plot["width"]
        and y + length <= usable_plot["y"] + usable_plot["length"]
    )


# ---------------------------------------------------------
# Find nearest available position
# ---------------------------------------------------------

def find_position(
    width: float,
    length: float,
    usable_plot: Dict,
    placed_rooms: List[Dict],
    preferred_x: float,
    preferred_y: float,
    step: float = 1.0
):

    min_x = usable_plot["x"]
    min_y = usable_plot["y"]

    max_x = (
        usable_plot["x"]
        + usable_plot["width"]
        - width
    )

    max_y = (
        usable_plot["y"]
        + usable_plot["length"]
        - length
    )

    if max_x < min_x or max_y < min_y:
        return None

    # First try preferred position
    if (
        fits_inside(
            preferred_x,
            preferred_y,
            width,
            length,
            usable_plot
        )
        and not rectangles_overlap(
            preferred_x,
            preferred_y,
            width,
            length,
            placed_rooms
        )
    ):
        return preferred_x, preferred_y

    # Search from top to bottom / left to right
    y = min_y

    while y <= max_y + 0.001:

        x = min_x

        while x <= max_x + 0.001:

            if not rectangles_overlap(
                x,
                y,
                width,
                length,
                placed_rooms
            ):
                return x, y

            x += step

        y += step

    return None


# ---------------------------------------------------------
# Functional zone placement
# ---------------------------------------------------------

def generate_functional_layout(
    usable_plot: Dict,
    rooms: List[Dict],
    road_side: str = "North"
) -> Dict:
    """
    Generate a more functional layout using zones.

    Basic structure:

        Public zone
            ↓
        Service zone
            ↓
        Private zone

    Road side influences the entrance/public zone.
    """

    usable_x = usable_plot["x"]
    usable_y = usable_plot["y"]
    usable_width = usable_plot["width"]
    usable_length = usable_plot["length"]

    placed_rooms = []
    errors = []

    # -----------------------------------------------------
    # Sort rooms according to architectural priority
    # -----------------------------------------------------

    sorted_rooms = sorted(
        rooms,
        key=lambda room: ROOM_PRIORITY.get(
            room["room_type"],
            100
        )
    )

    # -----------------------------------------------------
    # Divide usable plot into functional zones
    # -----------------------------------------------------

    public_depth = usable_length * 0.30
    service_depth = usable_length * 0.25
    private_depth = usable_length * 0.45

    # The exact coordinate direction depends on road.
    # For this prototype, we treat the road-facing side
    # as the public/entrance side.
    #
    # The validator still guarantees the hard boundary.

    if road_side.lower() == "north":

        public_y = (
            usable_y
            + usable_length
            - public_depth
        )

        service_y = (
            public_y
            - service_depth
        )

        private_y = usable_y

    else:

        public_y = usable_y

        service_y = (
            public_y
            + public_depth
        )

        private_y = (
            service_y
            + service_depth
        )

    # -----------------------------------------------------
    # Preferred positions
    # -----------------------------------------------------

    preferred_positions = {

        "living_room": (
            usable_x,
            public_y
        ),

        "dining": (
            usable_x + usable_width * 0.40,
            public_y
        ),

        "kitchen": (
            usable_x + usable_width * 0.45,
            service_y
        ),

        "utility": (
            usable_x + usable_width * 0.70,
            service_y
        ),

        "master_bedroom": (
            usable_x,
            private_y
        ),

        "bedroom": (
            usable_x + usable_width * 0.50,
            private_y
        ),

        "guest_bedroom": (
            usable_x + usable_width * 0.50,
            private_y
        ),

        "bathroom": (
            usable_x + usable_width * 0.75,
            private_y
        ),

        "puja_room": (
            usable_x + usable_width * 0.05,
            service_y
        )
    }

    # -----------------------------------------------------
    # Place rooms
    # -----------------------------------------------------

    for room in sorted_rooms:

        room_type = room["room_type"]
        width = float(room["width"])
        length = float(room["length"])

        preferred = preferred_positions.get(
            room_type,
            (
                usable_x,
                usable_y
            )
        )

        position = find_position(
            width=width,
            length=length,
            usable_plot=usable_plot,
            placed_rooms=placed_rooms,
            preferred_x=preferred[0],
            preferred_y=preferred[1],
            step=1.0
        )

        if position is None:

            errors.append(
                f"Could not place {room_type} "
                f"without overlap."
            )

            continue

        x, y = position

        new_room = make_room(
            room_type,
            width,
            length,
            x,
            y
        )

        placed_rooms.append(new_room)

    # -----------------------------------------------------
    # Functional relationship information
    # -----------------------------------------------------

    relationships = []

    def add_relationship(
        room_a,
        room_b,
        relationship
    ):

        if (
            get_room(placed_rooms, room_a)
            and get_room(placed_rooms, room_b)
        ):
            relationships.append({
                "room_a": room_a,
                "room_b": room_b,
                "relationship": relationship
            })

    add_relationship(
        "living_room",
        "dining",
        "strong_connection"
    )

    add_relationship(
        "dining",
        "kitchen",
        "strong_connection"
    )

    add_relationship(
        "kitchen",
        "utility",
        "direct_service_connection"
    )

    add_relationship(
        "master_bedroom",
        "bathroom",
        "private_connection"
    )

    # -----------------------------------------------------
    # Return layout
    # -----------------------------------------------------

    used_area = sum(
        room_area(room)
        for room in placed_rooms
    )

    return {
        "valid": len(errors) == 0,

        "usable_plot": usable_plot,

        "rooms": placed_rooms,

        "used_room_area": round(
            used_area,
            2
        ),

        "remaining_area": round(
            usable_width * usable_length
            - used_area,
            2
        ),

        "functional_zones": {
            "public": [
                room["room_type"]
                for room in placed_rooms
                if room["room_type"] in PUBLIC_ROOMS
            ],

            "service": [
                room["room_type"]
                for room in placed_rooms
                if room["room_type"] in SERVICE_ROOMS
            ],

            "private": [
                room["room_type"]
                for room in placed_rooms
                if room["room_type"] in PRIVATE_ROOMS
            ],

            "wet": [
                room["room_type"]
                for room in placed_rooms
                if room["room_type"] in WET_ROOMS
            ]
        },

        "relationships": relationships,

        "errors": errors
    }