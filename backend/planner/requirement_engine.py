from copy import deepcopy


BHK_CONFIG = {
    1: {
        "bedrooms": 1,
        "bathrooms": 1,
    },
    2: {
        "bedrooms": 2,
        "bathrooms": 2,
    },
    3: {
        "bedrooms": 3,
        "bathrooms": 3,
    },
    4: {
        "bedrooms": 4,
        "bathrooms": 4,
    },
}


BUILDING_TYPES = {
    "Ground": 1,
    "G+1": 2,
    "G+2": 3,
    "Duplex": 2,
    "Villa": 3,
}


def create_room_requirements(
    bhk=2,
    bathrooms=None,
    include_guest=False,
    include_puja=False,
    include_utility=True,
    include_dining=True,
    include_kitchen=True,
    include_living=True,
):
    """
    Convert user requirements into a clean room list.
    """

    if bhk not in BHK_CONFIG:
        raise ValueError("BHK must be between 1 and 4.")

    config = BHK_CONFIG[bhk]

    bedroom_count = config["bedrooms"]

    bathroom_count = (
        bathrooms
        if bathrooms is not None
        else config["bathrooms"]
    )

    if bathroom_count < 1:
        bathroom_count = 1

    rooms = []

    # Public spaces
    if include_living:
        rooms.append({"room_type": "living_room"})

    if include_dining:
        rooms.append({"room_type": "dining"})

    # Service spaces
    if include_kitchen:
        rooms.append({"room_type": "kitchen"})

    if include_utility:
        rooms.append({"room_type": "utility"})

    # Bedrooms
    rooms.append({"room_type": "master_bedroom"})

    for _ in range(max(0, bedroom_count - 1)):
        rooms.append({"room_type": "bedroom"})

    # Guest bedroom is additional to BHK bedrooms.
    if include_guest:
        rooms.append({"room_type": "guest_bedroom"})

    # Bathrooms
    for _ in range(bathroom_count):
        rooms.append({"room_type": "bathroom"})

    # Optional puja
    if include_puja:
        rooms.append({"room_type": "puja_room"})

    return rooms


def get_building_floor_count(building_type):
    """
    Return the number of floors for the selected building type.
    """

    if building_type not in BUILDING_TYPES:
        raise ValueError(
            f"Unsupported building type: {building_type}"
        )

    return BUILDING_TYPES[building_type]


def calculate_parking_area(
    parking_required=False,
    parking_spaces=1,
    parking_width=9,
    parking_length=18,
):
    """
    Calculate parking area that should be reserved
    outside the house usable area.
    """

    if not parking_required:
        return {
            "required": False,
            "spaces": 0,
            "width": 0,
            "length": 0,
            "area": 0,
        }

    parking_spaces = max(1, int(parking_spaces))

    total_area = (
        parking_width
        * parking_length
        * parking_spaces
    )

    return {
        "required": True,
        "spaces": parking_spaces,
        "width": parking_width,
        "length": parking_length,
        "area": total_area,
    }


def apply_requirements(
    rooms,
    building_type="Ground",
    parking_required=False,
    parking_spaces=1,
):
    """
    Add building and parking information to the design.
    """

    updated_rooms = deepcopy(rooms)

    floor_count = get_building_floor_count(
        building_type
    )

    parking = calculate_parking_area(
        parking_required=parking_required,
        parking_spaces=parking_spaces,
    )

    return {
        "rooms": updated_rooms,
        "building_type": building_type,
        "floor_count": floor_count,
        "parking": parking,
    }