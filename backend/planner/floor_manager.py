"""
Multi-floor building manager.

Handles:
- Ground
- G+1
- G+2
- Duplex
- Villa
- Terrace

Allocates rooms intelligently across floors.
"""

from copy import deepcopy


# =========================================================
# BUILDING TYPES
# =========================================================

BUILDING_FLOORS = {
    "Ground": [
        "Ground Floor"
    ],

    "G+1": [
        "Ground Floor",
        "First Floor"
    ],

    "G+2": [
        "Ground Floor",
        "First Floor",
        "Second Floor"
    ],

    "Duplex": [
        "Ground Floor",
        "First Floor"
    ],

    "Villa": [
        "Ground Floor",
        "First Floor",
        "Second Floor"
    ],
}


# =========================================================
# ROOM CATEGORIES
# =========================================================

GROUND_PRIORITY = {
    "living_room",
    "dining",
    "kitchen",
    "utility",
    "puja_room",
}

BEDROOM_TYPES = {
    "master_bedroom",
    "bedroom",
    "guest_bedroom",
}

BATHROOM_TYPES = {
    "bathroom",
}


# =========================================================
# FLOOR INFORMATION
# =========================================================

def get_floors(building_type):
    """
    Return floors for selected building type.
    """

    if building_type not in BUILDING_FLOORS:
        raise ValueError(
            f"Unsupported building type: {building_type}"
        )

    return deepcopy(
        BUILDING_FLOORS[building_type]
    )


# =========================================================
# TERRACE
# =========================================================

def create_terrace(include_terrace=True):
    """
    Create terrace configuration.
    """

    if not include_terrace:
        return None

    return {
        "name": "Terrace",
        "type": "Open Terrace",
        "areas": [
            "Open Terrace",
            "Utility Area",
            "Solar Area",
            "Seating Area",
        ],
    }


# =========================================================
# HELPER
# =========================================================

def clone_room(room):
    """
    Safely copy a room.
    """

    return deepcopy(room)


# =========================================================
# ROOM ALLOCATION
# =========================================================

def allocate_rooms_to_floors(
    rooms,
    building_type="Ground",
    family_context=None,
):
    """
    Allocate rooms across multiple floors.

    Ground Floor:
        Public and service spaces.

    Upper Floors:
        Bedrooms and associated bathrooms.

    For G+2 / Villa:
        Bedrooms are distributed across available
        upper floors instead of placing all of them
        on the first floor.
    """

    floors = get_floors(building_type)

    allocation = {
        floor: []
        for floor in floors
    }

    ground_floor = floors[0]

    # -----------------------------------------------------
    # Ground-only building
    # -----------------------------------------------------

    if len(floors) == 1:

        allocation[ground_floor] = [
            clone_room(room)
            for room in rooms
        ]

        return allocation

    upper_floors = floors[1:]

    # -----------------------------------------------------
    # Separate room categories
    # -----------------------------------------------------

    public_rooms = []
    bedrooms = []
    bathrooms = []
    staircases = []
    other_rooms = []

    for room in rooms:

        room_type = room.get("room_type")

        if room_type in GROUND_PRIORITY:
            public_rooms.append(room)

        elif room_type in BEDROOM_TYPES:
            bedrooms.append(room)

        elif room_type in BATHROOM_TYPES:
            bathrooms.append(room)

        elif room_type == "staircase":
            staircases.append(room)

        else:
            other_rooms.append(room)

    family_context = family_context or {}
    elderly_count = int(family_context.get("elderly", 0) or 0)

    # -----------------------------------------------------
    # Public/service rooms → Ground
    # -----------------------------------------------------

    for room in public_rooms:

        allocation[ground_floor].append(
            clone_room(room)
        )

    # A staircase is a shared vertical element. Its ground footprint is
    # complete; upper floors receive only the arrival/opening footprint.
    for staircase in staircases:
        ground_staircase = clone_room(staircase)
        ground_staircase["staircase_role"] = "ground"
        allocation[ground_floor].append(ground_staircase)
        for floor_name in upper_floors:
            arrival = clone_room(staircase)
            arrival["staircase_role"] = "arrival"
            allocation[floor_name].append(arrival)

    # -----------------------------------------------------
    # Guest bedroom → Ground
    # -----------------------------------------------------

    guest_bedrooms = [
        room
        for room in bedrooms
        if room.get("room_type") == "guest_bedroom"
    ]

    normal_bedrooms = [
        room
        for room in bedrooms
        if room.get("room_type") != "guest_bedroom"
    ]

    for room in guest_bedrooms:

        allocation[ground_floor].append(
            clone_room(room)
        )

    # -----------------------------------------------------
    # Master bedroom → First Floor
    # -----------------------------------------------------

    master_bedrooms = [
        room
        for room in normal_bedrooms
        if room.get("room_type") == "master_bedroom"
    ]

    other_bedrooms = [
        room
        for room in normal_bedrooms
        if room.get("room_type") != "master_bedroom"
    ]

    if master_bedrooms:
        if elderly_count > 0:
            allocation[ground_floor].append(
                clone_room(master_bedrooms[0])
            )
        else:
            allocation[upper_floors[0]].append(
                clone_room(master_bedrooms[0])
            )

    # -----------------------------------------------------
    # Remaining bedrooms
    #
    # IMPORTANT:
    # Start distributing from First Floor,
    # but move to Second Floor when available.
    # -----------------------------------------------------

    floor_index = 0

    for room in other_bedrooms:

        target_floor = upper_floors[
            floor_index % len(upper_floors)
        ]

        allocation[target_floor].append(
            clone_room(room)
        )

        floor_index += 1

    # -----------------------------------------------------
    # Bathrooms
    #
    # Put bathrooms on floors that contain bedrooms.
    # -----------------------------------------------------

    bedroom_floor_indexes = []

    for index, floor_name in enumerate(upper_floors):

        has_bedroom = any(
            room.get("room_type") in BEDROOM_TYPES
            for room in allocation[floor_name]
        )

        if has_bedroom:
            bedroom_floor_indexes.append(index)

    ground_bedrooms = [
        room for room in allocation[ground_floor]
        if room.get("room_type") in BEDROOM_TYPES
    ]
    preferred_ground_bedroom = next(
        (
            room for room in ground_bedrooms
            if room.get("room_type") == "guest_bedroom"
        ),
        ground_bedrooms[0] if elderly_count and ground_bedrooms else None,
    )
    bathroom_index = 0

    for bathroom in bathrooms:

        if bathroom_index == 0:
            target_floor = ground_floor
            if preferred_ground_bedroom is not None:
                bathroom = clone_room(bathroom)
                bathroom["attached_to"] = preferred_ground_bedroom["room_type"]
            else:
                bathroom = clone_room(bathroom)
                bathroom["access_type"] = "common"
        elif bedroom_floor_indexes:

            floor_index = bedroom_floor_indexes[
                bathroom_index % len(bedroom_floor_indexes)
            ]

            target_floor = upper_floors[floor_index]

        else:

            target_floor = ground_floor

        allocation[target_floor].append(clone_room(bathroom))

        bathroom_index += 1

    # -----------------------------------------------------
    # Other rooms → Ground
    # -----------------------------------------------------

    for room in other_rooms:

        allocation[ground_floor].append(
            clone_room(room)
        )

    return allocation


# =========================================================
# COMPLETE BUILDING STRUCTURE
# =========================================================

def create_building_structure(
    rooms,
    building_type="Ground",
    include_terrace=True,
    family_context=None,
):
    """
    Create complete multi-floor building structure.
    """

    floor_names = get_floors(
        building_type
    )

    room_allocation = allocate_rooms_to_floors(
        rooms=rooms,
        building_type=building_type,
        family_context=family_context,
    )

    terrace = create_terrace(
        include_terrace=include_terrace
    )

    floors = []

    for floor_name in floor_names:

        floors.append({
            "floor": floor_name,
            "rooms": room_allocation.get(
                floor_name,
                []
            ),
        })

    return {
        "building_type": building_type,
        "floors": floors,
        "terrace": terrace,
    }


# =========================================================
# SUMMARY
# =========================================================

def summarize_building(building):
    """
    Create a simple building summary.
    """

    summary = {
        "building_type": building[
            "building_type"
        ],

        "floor_count": len(
            building["floors"]
        ),

        "floors": [],

        "terrace": (
            building.get("terrace") is not None
        ),
    }

    for floor in building["floors"]:

        summary["floors"].append({

            "floor": floor["floor"],

            "room_count": len(
                floor["rooms"]
            ),

            "rooms": [
                room.get("room_type")
                for room in floor["rooms"]
            ],
        })

    return summary