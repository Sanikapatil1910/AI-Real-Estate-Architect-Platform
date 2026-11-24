from typing import Dict, List


ROOM_RULES: Dict[str, Dict] = {
    "living_room": {
        "min_area": 120,
        "preferred_area": 180,
        "max_area": 350,
        "min_width": 10,
        "preferred_width": 12,
        "min_length": 10,
        "preferred_length": 15,
        "max_aspect_ratio": 2.0,
    },

    "dining": {
        "min_area": 80,
        "preferred_area": 120,
        "max_area": 220,
        "min_width": 8,
        "preferred_width": 10,
        "min_length": 8,
        "preferred_length": 12,
        "max_aspect_ratio": 2.0,
    },

    "kitchen": {
        "min_area": 70,
        "preferred_area": 100,
        "max_area": 180,
        "min_width": 7,
        "preferred_width": 9,
        "min_length": 8,
        "preferred_length": 11,
        "max_aspect_ratio": 2.0,
    },

    "master_bedroom": {
        "min_area": 120,
        "preferred_area": 160,
        "max_area": 250,
        "min_width": 10,
        "preferred_width": 12,
        "min_length": 11,
        "preferred_length": 14,
        "max_aspect_ratio": 1.8,
    },

    "bedroom": {
        "min_area": 90,
        "preferred_area": 120,
        "max_area": 200,
        "min_width": 9,
        "preferred_width": 10,
        "min_length": 10,
        "preferred_length": 12,
        "max_aspect_ratio": 1.8,
    },

    "guest_bedroom": {
        "min_area": 90,
        "preferred_area": 120,
        "max_area": 200,
        "min_width": 9,
        "preferred_width": 10,
        "min_length": 10,
        "preferred_length": 12,
        "max_aspect_ratio": 1.8,
    },

    "parking": {
        "min_area": 135, "preferred_area": 170, "max_area": 480,
        "min_width": 8.5, "preferred_width": 9, "min_length": 15, "preferred_length": 18,
        "max_aspect_ratio": 3.0,
    },

    "bike_parking": {
        "min_area": 45, "preferred_area": 80, "max_area": 170,
        "min_width": 6, "preferred_width": 8, "min_length": 8, "preferred_length": 10,
        "max_aspect_ratio": 3.5,
    },

    "toilet": {
        "min_area": 16,
        "preferred_area": 22,
        "max_area": 40,
        "min_width": 3.5,
        "preferred_width": 4,
        "min_length": 4.5,
        "preferred_length": 5.5,
        "max_aspect_ratio": 2.2,
    },

    "bathroom": {
        "min_area": 35,
        "preferred_area": 45,
        "max_area": 100,
        "min_width": 5,
        "preferred_width": 6,
        "min_length": 6,
        "preferred_length": 8,
        "max_aspect_ratio": 2.0,
    },

    "utility": {
        "min_area": 30,
        "preferred_area": 45,
        "max_area": 100,
        "min_width": 5,
        "preferred_width": 6,
        "min_length": 6,
        "preferred_length": 8,
        "max_aspect_ratio": 2.0,
    },

    "puja_room": {
        "min_area": 20,
        "preferred_area": 35,
        "max_area": 80,
        "min_width": 4,
        "preferred_width": 5,
        "min_length": 5,
        "preferred_length": 7,
        "max_aspect_ratio": 2.0,
    },

    # Dog-leg stair: two 3.5 ft flights side by side (7 ft) with a landing;
    # the run is ~10.2 ft for a 10 ft floor-to-floor height.
    "staircase": {
        "min_area": 70,
        "preferred_area": 80,
        "max_area": 180,
        "min_width": 7,
        "preferred_width": 7,
        "min_length": 10,
        "preferred_length": 11,
        "max_aspect_ratio": 2.2,
    },

    # ---- types produced by the architect engine -------------------------
    "passage": {
        "min_area": 12,
        "preferred_area": 60,
        "max_area": 400,
        "min_width": 3.0,
        "preferred_width": 3.5,
        "min_length": 3.0,
        "preferred_length": 12,
        "max_aspect_ratio": 25.0,
    },
    "family_lounge": {
        "min_area": 100,
        "preferred_area": 140,
        "max_area": 300,
        "min_width": 9,
        "preferred_width": 11,
        "min_length": 10,
        "preferred_length": 13,
        "max_aspect_ratio": 2.0,
    },
    "study": {
        "min_area": 64,
        "preferred_area": 90,
        "max_area": 160,
        "min_width": 8,
        "preferred_width": 9,
        "min_length": 8,
        "preferred_length": 10,
        "max_aspect_ratio": 2.0,
    },
    "balcony": {
        "min_area": 24,
        "preferred_area": 45,
        "max_area": 140,
        "min_width": 3.5,
        "preferred_width": 4,
        "min_length": 6,
        "preferred_length": 10,
        "max_aspect_ratio": 6.0,
    },
    "open_terrace": {
        "min_area": 1,
        "preferred_area": 100,
        "max_area": 5000,
        "min_width": 1,
        "preferred_width": 8,
        "min_length": 1,
        "preferred_length": 10,
        "max_aspect_ratio": 60.0,
    },
}


def get_room_rule(room_type: str) -> Dict:
    """
    Return the design rules for a room type.
    """

    room_type = room_type.lower().strip()

    if room_type not in ROOM_RULES:
        raise ValueError(f"Unknown room type: {room_type}")

    return ROOM_RULES[room_type]


def validate_room_dimensions(
    room_type: str,
    width: float,
    length: float,
) -> Dict:

    rule = get_room_rule(room_type)

    area = width * length
    aspect_ratio = max(width, length) / min(width, length)

    errors: List[str] = []
    warnings: List[str] = []

    # Orientation-independent: the road can be on any side, so a room that is
    # 12 x 9 ft is the same room as 9 x 12 ft. Compare the short side with the
    # rule's minimum width and the long side with its minimum length.
    short_side = min(width, length)
    long_side = max(width, length)

    if short_side < rule["min_width"] - 1e-6:
        errors.append(
            f"Short side {short_side:.1f} ft is below the minimum "
            f"of {rule['min_width']} ft."
        )

    if long_side < rule["min_length"] - 1e-6:
        errors.append(
            f"Long side {long_side:.1f} ft is below the minimum "
            f"of {rule['min_length']} ft."
        )

    if area < rule["min_area"] - 1e-6:
        errors.append(
            f"Area {area:.1f} sq.ft is below the minimum "
            f"of {rule['min_area']} sq.ft."
        )

    if area > rule["max_area"]:
        warnings.append(
            f"Area {area:.1f} sq.ft is larger than the preferred "
            f"range for this room."
        )

    if aspect_ratio > rule["max_aspect_ratio"] + 1e-6:
        errors.append(
            f"Room is too elongated. Aspect ratio is "
            f"{aspect_ratio:.2f}, maximum allowed is "
            f"{rule['max_aspect_ratio']:.2f}."
        )

    return {
        "valid": len(errors) == 0,
        "room_type": room_type,
        "width": width,
        "length": length,
        "area": round(area, 2),
        "aspect_ratio": round(aspect_ratio, 2),
        "errors": errors,
        "warnings": warnings,
    }