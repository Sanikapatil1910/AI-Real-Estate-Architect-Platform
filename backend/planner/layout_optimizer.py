from typing import Dict, List, Tuple
from math import hypot

from backend.planner.vastu_rules import score_room_vastu
from backend.planner.relationship_rules import get_relationship_weight


# ============================================================
# RELATIONSHIPS
# ============================================================

RELATIONSHIP_WEIGHTS = {
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

    ("living_room", "staircase"): 7,
    ("dining", "staircase"): 8,
    ("kitchen", "staircase"): 5,
}


PRIVATE_ROOMS = {
    "master_bedroom",
    "bedroom",
    "guest_bedroom",
}


SERVICE_ROOMS = {
    "kitchen",
    "utility",
    "bathroom",
}


COMMON_ROOMS = {
    "living_room",
    "dining",
    "kitchen",
    "utility",
    "puja_room",
}


REQUIRED_ADJACENCIES = [
    ("living_room", "dining"),
    ("dining", "kitchen"),
    ("kitchen", "utility"),
]


# ============================================================
# TOPOLOGY PROFILES
# ============================================================

TOPOLOGY_PROFILES = {
    "space_efficient": "front_public",
    "balanced": "central_circulation",
    "comfort": "side_public",
    "luxury": "courtyard",
}

# Preferred anchor locations are expressed as fractions of the usable plot.
# They deliberately create different architectural compositions rather than
# simply translating the same row of rooms.
TOPOLOGY_ANCHORS = {
    "space_efficient": {
        "living": (0.15, 0.78), "dining": (0.40, 0.72),
        "kitchen": (0.68, 0.72), "private": (0.65, 0.25),
        "service": (0.86, 0.25), "stair": (0.12, 0.42),
    },
    "balanced": {
        "living": (0.20, 0.60), "dining": (0.48, 0.60),
        "kitchen": (0.72, 0.60), "private": (0.55, 0.18),
        "service": (0.84, 0.18), "stair": (0.18, 0.40),
    },
    "comfort": {
        "living": (0.12, 0.45), "dining": (0.40, 0.45),
        "kitchen": (0.72, 0.72), "private": (0.58, 0.72),
        "service": (0.86, 0.70), "stair": (0.10, 0.78),
    },
    "luxury": {
        "living": (0.18, 0.76), "dining": (0.48, 0.76),
        "kitchen": (0.76, 0.76), "private": (0.68, 0.24),
        "service": (0.86, 0.42), "stair": (0.20, 0.40),
    },
}


# ============================================================
# BASIC GEOMETRY
# ============================================================

def room_center(room: Dict) -> Tuple[float, float]:
    """Return center point of a room."""

    x = float(room.get("x", 0))
    y = float(room.get("y", 0))
    width = float(room.get("width", 0))
    length = float(room.get("length", 0))

    return (
        x + width / 2,
        y + length / 2,
    )


def rectangles_overlap(
    room_a: Dict,
    room_b: Dict,
) -> bool:
    """Check whether two rooms overlap."""

    ax1 = float(room_a["x"])
    ay1 = float(room_a["y"])
    ax2 = ax1 + float(room_a["width"])
    ay2 = ay1 + float(room_a["length"])

    bx1 = float(room_b["x"])
    by1 = float(room_b["y"])
    bx2 = bx1 + float(room_b["width"])
    by2 = by1 + float(room_b["length"])

    return not (
        ax2 <= bx1
        or bx2 <= ax1
        or ay2 <= by1
        or by2 <= ay1
    )


def fits_inside(
    room: Dict,
    usable_plot: Dict,
) -> bool:
    """Check whether room fits inside usable plot."""

    plot_x = float(usable_plot.get("x", 0))
    plot_y = float(usable_plot.get("y", 0))

    plot_width = float(
        usable_plot.get(
            "width",
            usable_plot.get("usable_width", 0),
        )
    )

    plot_length = float(
        usable_plot.get(
            "length",
            usable_plot.get("usable_length", 0),
        )
    )

    x = float(room.get("x", 0))
    y = float(room.get("y", 0))

    width = float(room.get("width", 0))
    length = float(room.get("length", 0))

    return (
        x >= plot_x
        and y >= plot_y
        and x + width <= plot_x + plot_width + 0.001
        and y + length <= plot_y + plot_length + 0.001
    )


def _reserved_regions(usable_plot: Dict) -> List[Dict]:
    return usable_plot.get("reserved_regions", [])


def _overlaps_reserved(room: Dict, usable_plot: Dict) -> bool:
    return any(
        rectangles_overlap(room, reserved)
        for reserved in _reserved_regions(usable_plot)
    )


def make_room(
    room_type: str,
    width: float,
    length: float,
    x: float,
    y: float,
) -> Dict:
    """Create a standard room dictionary."""

    return {
        "room_type": room_type,
        "width": round(float(width), 2),
        "length": round(float(length), 2),
        "area": round(
            float(width) * float(length),
            2,
        ),
        "x": round(float(x), 2),
        "y": round(float(y), 2),
        "x2": round(
            float(x) + float(width),
            2,
        ),
        "y2": round(
            float(y) + float(length),
            2,
        ),
    }


# ============================================================
# RELATIONSHIP SCORING
# ============================================================

def get_relationship_weight(
    room_a: str,
    room_b: str,
) -> float:
    """Return relationship importance between two room types."""

    if (room_a, room_b) in RELATIONSHIP_WEIGHTS:
        return RELATIONSHIP_WEIGHTS[
            (room_a, room_b)
        ]

    if (room_b, room_a) in RELATIONSHIP_WEIGHTS:
        return RELATIONSHIP_WEIGHTS[
            (room_b, room_a)
        ]

    return 0.0


def distance_between_rooms(
    room_a: Dict,
    room_b: Dict,
) -> float:
    """Calculate center-to-center distance."""

    ax, ay = room_center(room_a)
    bx, by = room_center(room_b)

    return hypot(
        ax - bx,
        ay - by,
    )


def calculate_functional_score(
    rooms: List[Dict],
) -> float:
    """
    Calculate functional score based on
    important room relationships.
    """

    if len(rooms) < 2:
        return 0.0

    total_weight = 0.0
    weighted_score = 0.0

    for i, room_a in enumerate(rooms):

        for room_b in rooms[i + 1:]:

            weight = get_relationship_weight(
                room_a["room_type"],
                room_b["room_type"],
            )

            if weight <= 0:
                continue

            distance = distance_between_rooms(
                room_a,
                room_b,
            )

            proximity = 1.0 / (
                1.0 + distance / 10.0
            )

            weighted_score += (
                weight * proximity
            )

            total_weight += weight

    if total_weight == 0:
        return 50.0

    score = (
        weighted_score
        / total_weight
    ) * 100.0

    return round(
        max(
            0.0,
            min(100.0, score),
        ),
        2,
    )


# ============================================================
# PLOT HELPERS
# ============================================================

def _plot_dimensions(
    usable_plot: Dict,
) -> Tuple[float, float, float, float]:
    """Return x, y, width, length of usable plot."""

    x = float(
        usable_plot.get("x", 0)
    )

    y = float(
        usable_plot.get("y", 0)
    )

    width = float(
        usable_plot.get(
            "width",
            usable_plot.get(
                "usable_width",
                0,
            ),
        )
    )

    length = float(
        usable_plot.get(
            "length",
            usable_plot.get(
                "usable_length",
                0,
            ),
        )
    )

    return (
        x,
        y,
        width,
        length,
    )


def _plot_center(
    usable_plot: Dict,
) -> Tuple[float, float]:
    """Return center of usable plot."""

    x, y, width, length = (
        _plot_dimensions(
            usable_plot
        )
    )

    return (
        x + width / 2,
        y + length / 2,
    )


def _normalised_distance(
    point_a: Tuple[float, float],
    point_b: Tuple[float, float],
    usable_plot: Dict,
) -> float:
    """Return normalized distance between two points."""

    _, _, width, length = (
        _plot_dimensions(
            usable_plot
        )
    )

    diagonal = hypot(
        width,
        length,
    )

    if diagonal <= 0:
        return 0.0

    return hypot(
        point_a[0] - point_b[0],
        point_a[1] - point_b[1],
    ) / diagonal


def _coverage_score(
    rooms: List[Dict],
    usable_plot: Dict,
) -> float:
    """Reward reasonable use of available floor area."""

    _, _, width, length = (
        _plot_dimensions(
            usable_plot
        )
    )

    plot_area = width * length

    if plot_area <= 0:
        return 0.0

    used_area = sum(
        float(room.get("area", 0))
        for room in rooms
    )

    ratio = used_area / plot_area

    if ratio < 0.25:
        return 45.0

    if ratio <= 0.70:
        return 100.0

    if ratio <= 0.85:
        return 90.0

    if ratio <= 0.95:
        return 75.0

    return 55.0


def _portion_coverage_score(
    rooms: List[Dict],
    usable_plot: Dict,
) -> float:
    """Reward balanced room distribution."""

    if not rooms:
        return 0.0

    centers = [
        room_center(room)
        for room in rooms
    ]

    avg_x = (
        sum(
            point[0]
            for point in centers
        )
        / len(centers)
    )

    avg_y = (
        sum(
            point[1]
            for point in centers
        )
        / len(centers)
    )

    center = _plot_center(
        usable_plot
    )

    distance = _normalised_distance(
        (avg_x, avg_y),
        center,
        usable_plot,
    )

    return round(
        max(
            0.0,
            100.0 - distance * 100.0,
        ),
        2,
    )


def _edge_balance_score(
    rooms: List[Dict],
    usable_plot: Dict,
) -> float:
    """Reward layouts that use different edges reasonably."""

    if not rooms:
        return 0.0

    x, y, width, length = (
        _plot_dimensions(
            usable_plot
        )
    )

    right = x + width
    top = y + length

    touched_edges = set()

    for room in rooms:

        if abs(room["x"] - x) < 0.1:
            touched_edges.add("left")

        if abs(room["x2"] - right) < 0.1:
            touched_edges.add("right")

        if abs(room["y"] - y) < 0.1:
            touched_edges.add("bottom")

        if abs(room["y2"] - top) < 0.1:
            touched_edges.add("top")

    return min(
        100.0,
        40.0 + len(touched_edges) * 15.0,
    )


def _centroid_distribution_score(
    rooms: List[Dict],
    usable_plot: Dict,
) -> float:
    """Reward reasonable centroid placement."""

    if not rooms:
        return 0.0

    center = _plot_center(
        usable_plot
    )

    room_centers = [
        room_center(room)
        for room in rooms
    ]

    avg = (
        sum(
            p[0]
            for p in room_centers
        )
        / len(room_centers),
        sum(
            p[1]
            for p in room_centers
        )
        / len(room_centers),
    )

    distance = _normalised_distance(
        avg,
        center,
        usable_plot,
    )

    return round(
        max(
            0.0,
            100.0 - distance * 100.0,
        ),
        2,
    )


def _candidate_relationship_score(
    candidate_room: Dict,
    placed_rooms: List[Dict],
) -> float:
    """Score candidate based on nearby important rooms."""

    score = 0.0
    maximum = 0.0

    for other in placed_rooms:

        weight = get_relationship_weight(
            candidate_room["room_type"],
            other["room_type"],
        )

        if weight <= 0:
            continue

        distance = distance_between_rooms(
            candidate_room,
            other,
        )

        proximity = 1.0 / (
            1.0 + distance / 10.0
        )

        score += (
            weight * proximity
        )

        maximum += weight

    if maximum == 0:
        return 50.0

    return round(
        (score / maximum) * 100.0,
        2,
    )


# ============================================================
# ROAD LOGIC
# ============================================================

def _road_zone_score(
    room: Dict,
    usable_plot: Dict,
    road_side: str,
) -> float:
    """Score room placement relative to road."""

    x, y, width, length = (
        _plot_dimensions(
            usable_plot
        )
    )

    road_side = str(
        road_side or "North"
    ).lower()

    if road_side == "north":

        distance = (
            y
            + length
            - room["y2"]
        )

    elif road_side == "south":

        distance = (
            room["y"]
            - y
        )

    elif road_side == "east":

        distance = (
            x
            + width
            - room["x2"]
        )

    elif road_side == "west":

        distance = (
            room["x"]
            - x
        )

    else:

        distance = 0.0

    max_distance = max(
        width,
        length,
        1.0,
    )

    score = 100.0 - (
        max(0.0, distance)
        / max_distance
        * 100.0
    )

    return round(
        max(
            0.0,
            min(100.0, score),
        ),
        2,
    )


# ============================================================
# TOPOLOGY
# ============================================================

def _topology_score(
    room: Dict,
    rooms: List[Dict],
    usable_plot: Dict,
    strategy: str,
) -> float:
    """Score room according to chosen architectural topology."""

    x, y, width, length = (
        _plot_dimensions(
            usable_plot
        )
    )

    cx, cy = room_center(
        room
    )

    left = x
    right = x + width
    bottom = y
    top = y + length

    strategy = strategy or "balanced"

    if strategy == "space_efficient":

        edge_distance = min(
            abs(cx - left),
            abs(cx - right),
            abs(cy - bottom),
            abs(cy - top),
        )

        maximum = max(
            width,
            length,
            1.0,
        )

        return round(
            100.0
            - (
                edge_distance
                / maximum
                * 100.0
            ),
            2,
        )

    if strategy == "comfort":

        middle_x = (
            x + width / 2
        )

        side_distance = abs(
            cx - middle_x
        )

        return round(
            min(
                100.0,
                50.0
                + (
                    side_distance
                    / max(
                        width / 2,
                        1,
                    )
                )
                * 50.0,
            ),
            2,
        )

    if strategy == "luxury":

        center = _plot_center(
            usable_plot
        )

        distance = _normalised_distance(
            (cx, cy),
            center,
            usable_plot,
        )

        return round(
            max(
                0.0,
                100.0 - distance * 100.0,
            ),
            2,
        )

    center = _plot_center(
        usable_plot
    )

    distance = _normalised_distance(
        (cx, cy),
        center,
        usable_plot,
    )

    return round(
        max(
            0.0,
            100.0 - distance * 100.0,
        ),
        2,
    )


def _distribution_score(
    rooms: List[Dict],
    usable_plot: Dict,
    strategy: str,
) -> float:
    """Score overall room distribution."""

    if not rooms:
        return 0.0

    coverage = _coverage_score(
        rooms,
        usable_plot,
    )

    centroid = _centroid_distribution_score(
        rooms,
        usable_plot,
    )

    edge = _edge_balance_score(
        rooms,
        usable_plot,
    )

    return round(
        (
            coverage * 0.40
            + centroid * 0.35
            + edge * 0.25
        ),
        2,
    )


def _circulation_score(
    rooms: List[Dict],
) -> float:
    """Score overlap-free layouts with a connected room sequence."""

    if not rooms:
        return 0.0

    overlap_count = 0

    for i, room_a in enumerate(
        rooms
    ):

        for room_b in rooms[i + 1:]:

            if rectangles_overlap(
                room_a,
                room_b,
            ):
                overlap_count += 1

    if overlap_count:
        return max(0.0, 100.0 - overlap_count * 25.0)

    required_pairs = (
        ("living_room", "dining"),
        ("dining", "kitchen"),
        ("kitchen", "utility"),
    )
    connected = 0
    for first_type, second_type in required_pairs:
        first = next((r for r in rooms if r["room_type"] == first_type), None)
        second = next((r for r in rooms if r["room_type"] == second_type), None)
        if first and second and _has_required_shared_wall(first, second):
            connected += 1

    return round(70.0 + connected * 10.0, 2)


def _normalise_vastu_mode(mode: str) -> str:
    value = str(mode or "no_preference").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "none": "no_preference",
        "no": "no_preference",
        "no_preference": "no_preference",
        "basic_vastu": "basic",
        "strict_vastu": "strict",
    }
    return aliases.get(value, value)


def _placement_score(
    candidate_room: Dict,
    placed_rooms: List[Dict],
    usable_plot: Dict,
    road_side: str = "North",
    strategy: str = "balanced",
    vastu_mode: str = "basic",
) -> float:
    """Score a candidate using architecture, topology, road and Vastu."""
    mode = _normalise_vastu_mode(vastu_mode)

    relationship = _candidate_relationship_score(
        candidate_room, placed_rooms
    )
    topology = _topology_target_score(
        candidate_room, usable_plot, strategy
    )
    road_score = _road_zone_score(
        candidate_room, usable_plot, road_side
    )
    spread = _spread_score(
        candidate_room, placed_rooms, usable_plot, strategy
    )

    vastu_score = _vastu_candidate_score(
        candidate_room, usable_plot, mode
    )

    if mode == "no_preference":
        return round(
            relationship * 0.38
            + topology * 0.27
            + road_score * 0.15
            + spread * 0.20,
            2,
        )

    if mode == "strict":
        return round(
            relationship * 0.24
            + topology * 0.15
            + road_score * 0.10
            + spread * 0.11
            + vastu_score * 0.40,
            2,
        )

    return round(
        relationship * 0.31
        + topology * 0.20
        + road_score * 0.14
        + spread * 0.15
        + vastu_score * 0.20,
        2,
    )


def _topology_target_score(
    room: Dict,
    usable_plot: Dict,
    strategy: str,
) -> float:
    """Score how well a room matches its topology's target sector."""
    x, y, width, length = _plot_dimensions(usable_plot)
    cx, cy = room_center(room)
    profile = TOPOLOGY_ANCHORS.get(strategy, TOPOLOGY_ANCHORS["balanced"])
    rt = room["room_type"]
    if rt == "living_room":
        target = profile["living"]
    elif rt == "dining":
        target = profile["dining"]
    elif rt == "kitchen":
        target = profile["kitchen"]
    elif rt == "utility":
        target = profile["service"]
    elif rt == "staircase":
        target = profile["stair"]
    else:
        target = profile["private"]
    tx, ty = x + width * target[0], y + length * target[1]
    distance = _normalised_distance((cx, cy), (tx, ty), usable_plot)
    return round(max(0.0, 100.0 - distance * 140.0), 2)


def _spread_score(
    candidate: Dict,
    placed_rooms: List[Dict],
    usable_plot: Dict,
    strategy: str,
) -> float:
    """Reward intended sector distribution and discourage crowding."""
    if not placed_rooms:
        return 100.0
    x, y, width, length = _plot_dimensions(usable_plot)
    cx, cy = room_center(candidate)
    nx = (cx - x) / max(width, 1.0)
    ny = (cy - y) / max(length, 1.0)
    profile = TOPOLOGY_ANCHORS.get(strategy, TOPOLOGY_ANCHORS["balanced"])
    rt = candidate["room_type"]
    if rt == "living_room":
        target = profile["living"]
    elif rt == "dining":
        target = profile["dining"]
    elif rt == "kitchen":
        target = profile["kitchen"]
    elif rt == "utility":
        target = profile["service"]
    elif rt == "staircase":
        target = profile["stair"]
    else:
        target = profile["private"]
    target_distance = hypot(nx - target[0], ny - target[1])
    crowd_penalty = 0.0
    for other in placed_rooms:
        ox, oy = room_center(other)
        onx = (ox - x) / max(width, 1.0)
        ony = (oy - y) / max(length, 1.0)
        d = hypot(nx - onx, ny - ony)
        if d < 0.14:
            crowd_penalty += (0.14 - d) / 0.14 * 18.0
    return round(max(0.0, min(100.0, 100.0 - target_distance * 90.0 - crowd_penalty)), 2)


# ============================================================
# CANDIDATE GENERATION
# ============================================================

def generate_candidate_positions(
    room: Dict,
    usable_plot: Dict,
    grid: float = 1.0,
) -> List[Dict]:
    """Generate grid-based candidate positions."""

    x0, y0, plot_width, plot_length = (
        _plot_dimensions(
            usable_plot
        )
    )

    width = float(
        room["width"]
    )

    length = float(
        room["length"]
    )

    candidates = []

    max_x = (
        x0
        + plot_width
        - width
    )

    max_y = (
        y0
        + plot_length
        - length
    )

    if (
        max_x < x0
        or max_y < y0
    ):
        return []

    current_x = x0

    while current_x <= (
        max_x + 0.001
    ):

        current_y = y0

        while current_y <= (
            max_y + 0.001
        ):

            candidate = make_room(
                room["room_type"],
                width,
                length,
                current_x,
                current_y,
            )

            candidates.append(
                candidate
            )

            current_y += grid

        current_x += grid

    return candidates


def find_best_position(
    room: Dict,
    placed_rooms: List[Dict],
    usable_plot: Dict,
    road_side: str = "North",
    strategy: str = "balanced",
    vastu_mode: str = "basic",
) -> Dict | None:
    """Find best non-overlapping grid position."""

    candidates = generate_candidate_positions(
        room,
        usable_plot,
        grid=1.0,
    )

    valid_candidates = []

    for candidate in candidates:

        if not fits_inside(
            candidate,
            usable_plot,
        ):
            continue

        if _overlaps_reserved(candidate, usable_plot):
            continue

        overlap = False

        for other in placed_rooms:

            if rectangles_overlap(
                candidate,
                other,
            ):
                overlap = True
                break

        if overlap:
            continue

        score = _placement_score(
            candidate,
            placed_rooms,
            usable_plot,
            road_side,
            strategy,
            vastu_mode,
        )
        if strategy == "space_efficient":
            score += _road_zone_score(
                candidate,
                usable_plot,
                road_side,
            ) * 2.0

        valid_candidates.append(
            (
                score,
                candidate,
            )
        )

    if not valid_candidates:
        return None

    valid_candidates.sort(
        key=lambda item: item[0],
        reverse=True,
    )

    return valid_candidates[0][1]


# ============================================================
# SHARED WALL
# ============================================================

def _shared_wall_length(
    room_a: Dict,
    room_b: Dict,
) -> float:
    """Return length of shared wall."""

    tolerance = 0.05

    # Vertical shared wall.
    if abs(
        room_a["x2"]
        - room_b["x"]
    ) <= tolerance:

        overlap = (
            min(
                room_a["y2"],
                room_b["y2"],
            )
            - max(
                room_a["y"],
                room_b["y"],
            )
        )

        return max(
            0.0,
            overlap,
        )

    if abs(
        room_b["x2"]
        - room_a["x"]
    ) <= tolerance:

        overlap = (
            min(
                room_a["y2"],
                room_b["y2"],
            )
            - max(
                room_a["y"],
                room_b["y"],
            )
        )

        return max(
            0.0,
            overlap,
        )

    # Horizontal shared wall.
    if abs(
        room_a["y2"]
        - room_b["y"]
    ) <= tolerance:

        overlap = (
            min(
                room_a["x2"],
                room_b["x2"],
            )
            - max(
                room_a["x"],
                room_b["x"],
            )
        )

        return max(
            0.0,
            overlap,
        )

    if abs(
        room_b["y2"]
        - room_a["y"]
    ) <= tolerance:

        overlap = (
            min(
                room_a["x2"],
                room_b["x2"],
            )
            - max(
                room_a["x"],
                room_b["x"],
            )
        )

        return max(
            0.0,
            overlap,
        )

    return 0.0


def get_shared_wall(
    room_a: Dict,
    room_b: Dict,
) -> float:
    """Public shared-wall helper."""

    return _shared_wall_length(
        room_a,
        room_b,
    )


def _has_required_shared_wall(
    room_a: Dict,
    room_b: Dict,
) -> bool:
    """Check whether two rooms share a usable wall."""

    return (
        _shared_wall_length(
            room_a,
            room_b,
        )
        >= 1.0
    )


# ============================================================
# SHARED-WALL CANDIDATES
# ============================================================

def _candidate_points_near(
    room: Dict,
    anchor: Dict,
    gap: float = 0.0,
) -> List[Dict]:
    """
    Generate positions around an anchor room.

    These positions intentionally share a wall
    with the anchor.
    """

    width = float(
        room["width"]
    )

    length = float(
        room["length"]
    )

    candidates = []

    # Right.
    candidates.append(
        make_room(
            room["room_type"],
            width,
            length,
            anchor["x2"] + gap,
            anchor["y"],
        )
    )

    # Left.
    candidates.append(
        make_room(
            room["room_type"],
            width,
            length,
            anchor["x"]
            - width
            - gap,
            anchor["y"],
        )
    )

    # Above.
    candidates.append(
        make_room(
            room["room_type"],
            width,
            length,
            anchor["x"],
            anchor["y2"] + gap,
        )
    )

    # Below.
    candidates.append(
        make_room(
            room["room_type"],
            width,
            length,
            anchor["x"],
            anchor["y"]
            - length
            - gap,
        )
    )

    # Centered above.
    candidates.append(
        make_room(
            room["room_type"],
            width,
            length,
            anchor["x"]
            + (
                anchor["width"]
                - width
            )
            / 2,
            anchor["y2"] + gap,
        )
    )

    # Centered below.
    candidates.append(
        make_room(
            room["room_type"],
            width,
            length,
            anchor["x"]
            + (
                anchor["width"]
                - width
            )
            / 2,
            anchor["y"]
            - length
            - gap,
        )
    )

    # Centered right.
    candidates.append(
        make_room(
            room["room_type"],
            width,
            length,
            anchor["x2"] + gap,
            anchor["y"]
            + (
                anchor["length"]
                - length
            )
            / 2,
        )
    )

    # Centered left.
    candidates.append(
        make_room(
            room["room_type"],
            width,
            length,
            anchor["x"]
            - width
            - gap,
            anchor["y"]
            + (
                anchor["length"]
                - length
            )
            / 2,
        )
    )

    return candidates


def _valid_candidate(
    candidate: Dict,
    placed_rooms: List[Dict],
    usable_plot: Dict,
) -> bool:
    """Check candidate against plot and existing rooms."""

    if not fits_inside(
        candidate,
        usable_plot,
    ):
        return False

    if _overlaps_reserved(candidate, usable_plot):
        return False

    for existing in placed_rooms:

        if rectangles_overlap(
            candidate,
            existing,
        ):
            return False

    return True


# ============================================================
# ROOM PROFILES
# ============================================================

def _profile_point(
    room_type: str,
    usable_plot: Dict,
    road_side: str,
    strategy: str,
) -> Tuple[float, float]:
    """Return preferred anchor point for a room."""

    x, y, width, length = (
        _plot_dimensions(
            usable_plot
        )
    )

    road_side = str(
        road_side or "North"
    ).lower()

    strategy = strategy or "balanced"

    if room_type == "living_room":

        if road_side == "north":
            return (
                x + width * 0.15,
                y + length * 0.55,
            )

        if road_side == "south":
            return (
                x + width * 0.15,
                y + length * 0.05,
            )

        if road_side == "east":
            return (
                x + width * 0.55,
                y + length * 0.15,
            )

        return (
            x + width * 0.05,
            y + length * 0.15,
        )

    if room_type == "staircase":

        if strategy == "side_public":
            return (
                x + width * 0.70,
                y + length * 0.50,
            )

        if strategy == "courtyard":
            return (
                x + width * 0.45,
                y + length * 0.50,
            )

        return (
            x + width * 0.50,
            y + length * 0.50,
        )

    if room_type in PRIVATE_ROOMS:

        return (
            x + width * 0.50,
            y + length * 0.70,
        )

    if room_type == "puja_room":

        return (
            x + width * 0.75,
            y + length * 0.70,
        )

    return (
        x + width * 0.50,
        y + length * 0.50,
    )


# ============================================================
# VASTU SCORING
# ============================================================

def _vastu_candidate_score(
    room: Dict,
    usable_plot: Dict,
    mode: str = "basic",
) -> float:
    """
    Lightweight Vastu preference score.

    This is a soft preference, not a hard geometry rule.
    """

    x, y, width, length = _plot_dimensions(usable_plot)
    return float(score_room_vastu(
        room,
        width,
        length,
        mode=mode,
        origin_x=x,
        origin_y=y,
    )["score"])


# ============================================================
# ARCHITECTURAL VALIDATION
# ============================================================

def _architectural_errors(
    rooms: List[Dict],
) -> List[str]:
    """Return important architectural errors."""

    errors = []

    # --------------------------------------------------------
    # Required public/service chain.
    # --------------------------------------------------------

    for room_a_type, room_b_type in (
        REQUIRED_ADJACENCIES
    ):

        room_a = next(
            (
                room
                for room in rooms
                if room["room_type"]
                == room_a_type
            ),
            None,
        )

        room_b = next(
            (
                room
                for room in rooms
                if room["room_type"]
                == room_b_type
            ),
            None,
        )

        if room_a and room_b:

            if not _has_required_shared_wall(
                room_a,
                room_b,
            ):

                errors.append(
                    f"{room_a_type} should be connected to "
                    f"{room_b_type}."
                )

    # --------------------------------------------------------
    # Private bathrooms.
    # --------------------------------------------------------

    bathrooms = [
        room
        for room in rooms
        if room["room_type"]
        == "bathroom"
    ]

    private_rooms = [
        room
        for room in rooms
        if room["room_type"]
        in PRIVATE_ROOMS
    ]

    for bathroom in bathrooms:

        if private_rooms:

            connected = any(
                _has_required_shared_wall(
                    bathroom,
                    private_room,
                )
                for private_room
                in private_rooms
            )

            if not connected:

                errors.append(
                    "Bathroom should connect to a private room."
                )

    # --------------------------------------------------------
    # Staircase.
    # --------------------------------------------------------

    staircases = [
        room
        for room in rooms
        if room["room_type"]
        == "staircase"
    ]

    if staircases:

        common_rooms = [
            room
            for room in rooms
            if room["room_type"]
            in {
                "living_room",
                "dining",
                "kitchen",
                "utility",
            }
        ]

        for staircase in staircases:

            if staircase.get("staircase_role") == "arrival":
                connected = any(
                    _has_required_shared_wall(staircase, room)
                    for room in rooms
                    if room is not staircase
                )
                if connected:
                    continue

            if staircase.get("staircase_role") == "ground_fallback":
                continue

            connected = any(
                _has_required_shared_wall(
                    staircase,
                    common,
                )
                for common in common_rooms
            )

            if not connected:

                errors.append(
                    "Staircase must connect to the common circulation zone."
                )

    # --------------------------------------------------------
    # Overlaps.
    # --------------------------------------------------------

    for i, room_a in enumerate(
        rooms
    ):

        for room_b in rooms[i + 1:]:

            if rectangles_overlap(
                room_a,
                room_b,
            ):

                errors.append(
                    f"Room overlap: "
                    f"{room_a['room_type']} and "
                    f"{room_b['room_type']}."
                )

    return errors


# ============================================================
# PLACE CHAIN ROOM
# ============================================================

def _place_adjacent_room(
    room: Dict,
    anchor_types: List[str],
    placed_rooms: List[Dict],
    usable_plot: Dict,
    strategy: str = "balanced",
    road_side: str = "North",
    vastu_mode: str = "basic",
) -> Dict | None:
    """Choose the best valid shared-wall position instead of first-fit."""
    candidates = []
    for anchor_type in anchor_types:
        for anchor in [
            r for r in placed_rooms if r["room_type"] == anchor_type
        ]:
            for candidate in _candidate_points_near(room, anchor, gap=0):
                if not _valid_candidate(candidate, placed_rooms, usable_plot):
                    continue
                if not _has_required_shared_wall(candidate, anchor):
                    continue
                score = _placement_score(
                    candidate, placed_rooms, usable_plot,
                    road_side, strategy, vastu_mode
                )
                for anchor_room in placed_rooms:
                    if anchor_room["room_type"] in anchor_types:
                        score += get_relationship_weight(
                            room["room_type"], anchor_room["room_type"]
                        ) * 2.0
                candidates.append((score, candidate))

    if not candidates:
        return None

    mode_bias = {
        "strict": lambda item: (item[1]["x"], item[1]["y"]),
        "basic": lambda item: (item[1]["y"], item[1]["x"]),
        "no_preference": lambda item: (-item[1]["x"], -item[1]["y"]),
    }.get(vastu_mode, lambda item: (item[1]["x"], item[1]["y"]))
    candidates.sort(key=lambda item: (-item[0], *mode_bias(item)))
    return candidates[0][1]


# ============================================================
# PLACE LIVING ROOM
# ============================================================

def _place_living_room(
    room: Dict,
    placed_rooms: List[Dict],
    usable_plot: Dict,
    road_side: str,
    strategy: str,
    vastu_mode: str = "basic",
) -> Dict | None:
    """Place living room near road-facing boundary."""

    x, y, plot_width, plot_length = (
        _plot_dimensions(
            usable_plot
        )
    )

    width = room["width"]
    length = room["length"]

    road_side = str(
        road_side or "North"
    ).lower()

    candidates = []

    # Each strategy deliberately chooses a different road-facing
    # entrance/public-zone composition.
    if road_side == "north":
        if strategy == "space_efficient":
            positions = [(x, y + plot_length - length)]
        elif strategy == "balanced":
            positions = [(x + (plot_width - width) / 2, y + plot_length - length)]
        elif strategy == "comfort":
            positions = [(x + plot_width - width, y + plot_length - length)]
        else:  # courtyard/luxury: offset from the road and open toward the centre
            positions = [
                (x + plot_width * 0.25, y + plot_length - length),
                (x + plot_width * 0.50, y + plot_length - length),
            ]
    elif road_side == "south":
        if strategy == "space_efficient":
            positions = [(x, y)]
        elif strategy == "balanced":
            positions = [(x + (plot_width - width) / 2, y)]
        elif strategy == "comfort":
            positions = [(x + plot_width - width, y)]
        else:
            positions = [
                (x + plot_width * 0.25, y),
                (x + plot_width * 0.50, y),
            ]
    elif road_side == "east":
        if strategy == "space_efficient":
            positions = [(x + plot_width - width, y)]
        elif strategy == "balanced":
            positions = [(x + plot_width - width, y + (plot_length - length) / 2)]
        elif strategy == "comfort":
            positions = [(x + plot_width - width, y + plot_length - length)]
        else:
            positions = [
                (x + plot_width - width, y + plot_length * 0.25),
                (x + plot_width - width, y + plot_length * 0.50),
            ]
    else:  # west
        if strategy == "space_efficient":
            positions = [(x, y)]
        elif strategy == "balanced":
            positions = [(x, y + (plot_length - length) / 2)]
        elif strategy == "comfort":
            positions = [(x, y + plot_length - length)]
        else:
            positions = [
                (x, y + plot_length * 0.25),
                (x, y + plot_length * 0.50),
            ]

    candidates = [
        make_room(
            room["room_type"], width, length, px, py
        )
        for px, py in positions
    ]

    valid = []

    for candidate in candidates:

        if not _valid_candidate(
            candidate,
            placed_rooms,
            usable_plot,
        ):
            continue

        score = _road_zone_score(
            candidate,
            usable_plot,
            road_side,
        )

        score = _placement_score(
            candidate,
            placed_rooms,
            usable_plot,
            road_side,
            strategy,
            vastu_mode,
        )

        valid.append(
            (
                score,
                candidate,
            )
        )

    if not valid:
        return None

    valid.sort(
        key=lambda item: item[0],
        reverse=True,
    )

    return valid[0][1]


# ============================================================
# STAIRCASE PLACEMENT
# ============================================================

def _place_staircase(
    room: Dict,
    placed_rooms: List[Dict],
    usable_plot: Dict,
    strategy: str,
) -> Dict | None:
    """
    Deterministically place staircase after the common chain.
    """

    staircase_type = room["room_type"]

    if staircase_type != "staircase":
        return None

    if room.get("staircase_role") == "arrival":
        candidate = _place_adjacent_room(
            room,
            ["master_bedroom", "bedroom", "guest_bedroom"],
            placed_rooms,
            usable_plot,
            strategy=strategy,
            road_side="North",
            vastu_mode="no_preference",
        )
        return candidate or find_best_position(
            room,
            placed_rooms,
            usable_plot,
            "North",
            strategy,
            "no_preference",
        )

    anchor_priority = [
        "dining",
        "kitchen",
        "living_room",
        "utility",
    ]

    anchors = []

    for anchor_type in anchor_priority:

        for existing in placed_rooms:

            if existing["room_type"] == anchor_type:

                anchors.append(
                    existing
                )

    candidates = []

    for anchor in anchors:

        anchor_candidates = (
            _candidate_points_near(
                room,
                anchor,
                gap=0,
            )
        )

        for candidate in anchor_candidates:

            if not _valid_candidate(
                candidate,
                placed_rooms,
                usable_plot,
            ):
                continue

            if not _has_required_shared_wall(
                candidate,
                anchor,
            ):
                continue

            connection_count = 0

            for common in placed_rooms:

                if common["room_type"] not in {
                    "living_room",
                    "dining",
                    "kitchen",
                    "utility",
                }:
                    continue

                if _has_required_shared_wall(
                    candidate,
                    common,
                ):
                    connection_count += 1

            plot_center = _plot_center(
                usable_plot
            )

            candidate_center = room_center(
                candidate
            )

            central_distance = (
                _normalised_distance(
                    candidate_center,
                    plot_center,
                    usable_plot,
                )
            )

            centrality = (
                100.0
                - central_distance * 100.0
            )

            if strategy == "balanced":

                topology_bonus = centrality

            elif strategy == "comfort":

                topology_bonus = (
                    centrality * 0.50
                    + _edge_balance_score(
                        [candidate],
                        usable_plot,
                    ) * 0.50
                )

            elif strategy == "luxury":

                topology_bonus = centrality

            else:

                topology_bonus = (
                    100.0 - centrality
                )

            score = (
                connection_count * 30.0
                + topology_bonus * 0.70
            )

            candidates.append(
                (
                    score,
                    candidate,
                )
            )

    if candidates:

        candidates.sort(
            key=lambda item: item[0],
            reverse=True,
        )

        return candidates[0][1]

    # --------------------------------------------------------
    # Fallback positions.
    # --------------------------------------------------------

    x, y, width, length = (
        _plot_dimensions(
            usable_plot
        )
    )

    stair_width = room["width"]
    stair_length = room["length"]

    center_x = (
        x
        + (
            width
            - stair_width
        ) / 2
    )

    center_y = (
        y
        + (
            length
            - stair_length
        ) / 2
    )

    fallback_positions = [
        (
            center_x,
            center_y,
        ),
        (
            x,
            center_y,
        ),
        (
            x + width - stair_width,
            center_y,
        ),
        (
            center_x,
            y,
        ),
        (
            center_x,
            y + length - stair_length,
        ),
    ]

    for px, py in fallback_positions:

        candidate = make_room(
            "staircase",
            stair_width,
            stair_length,
            px,
            py,
        )

        if not _valid_candidate(
            candidate,
            placed_rooms,
            usable_plot,
        ):
            continue

        connected = any(
            _has_required_shared_wall(
                candidate,
                common,
            )
            for common in placed_rooms
            if common["room_type"]
            in {
                "living_room",
                "dining",
                "kitchen",
                "utility",
            }
        )

        if connected:
            return candidate

    # Dense programs may leave no common-room edge, but a wall-connected
    # circulation fallback is still preferable to an infeasible plan.
    for anchor in placed_rooms:
        for candidate in _candidate_points_near(room, anchor, gap=0):
            if _valid_candidate(candidate, placed_rooms, usable_plot):
                candidate["staircase_role"] = "ground_fallback"
                return candidate

    candidate = find_best_position(
        room,
        placed_rooms,
        usable_plot,
        "North",
        strategy,
        "no_preference",
    )
    if candidate is not None:
        candidate["staircase_role"] = "ground_fallback"
        return candidate

    return None


# ============================================================
# ZONE LAYOUT GENERATOR
# ============================================================

def generate_zone_layout(
    rooms: List[Dict],
    usable_plot: Dict,
    road_side: str = "North",
    strategy: str = "balanced",
    vastu_mode: str = "basic",
) -> Dict:
    """
    Main architectural layout generator.

    vastu_mode is accepted and passed throughout the
    placement process.

    Ordering:

        1. Living
        2. Dining
        3. Kitchen
        4. Utility
        5. Master bedroom
        6. Other bedrooms
        7. Bathrooms
        8. Puja
        9. Staircase LAST
    """

    ordered_rooms = [
        dict(room)
        for room in rooms
    ]

    priority = {
        "living_room": 1,
        "dining": 2,
        "kitchen": 3,
        "utility": 4,
        "master_bedroom": 5,
        "bedroom": 6,
        "guest_bedroom": 7,
        "bathroom": 8,
        "puja_room": 9,
        "staircase": 7.5,
    }

    ordered_rooms.sort(
        key=lambda room: priority.get(
            room["room_type"],
            99,
        )
    )

    # --------------------------------------------------------
    # Remove staircase temporarily.
    # --------------------------------------------------------

    staircase_rooms = [
        room
        for room in ordered_rooms
        if room["room_type"]
        == "staircase"
        and room.get("staircase_role") != "ground"
    ]

    ground_staircases = [
        room
        for room in ordered_rooms
        if room["room_type"] == "staircase"
        and room.get("staircase_role") == "ground"
    ]

    ordered_rooms = [
        room
        for room in ordered_rooms
        if room["room_type"]
        != "staircase"
    ]
    ordered_rooms.extend(ground_staircases)
    ordered_rooms.sort(
        key=lambda room: priority.get(room["room_type"], 99)
    )

    placed_rooms = []
    errors = []

    # ========================================================
    # MAIN ROOM PLACEMENT
    # ========================================================

    for room in ordered_rooms:

        room_type = room["room_type"]

        # ----------------------------------------------------
        # Living
        # ----------------------------------------------------

        if room_type == "living_room":

            candidate = _place_living_room(
                room,
                placed_rooms,
                usable_plot,
                road_side,
                strategy,
                vastu_mode,
            )

            if candidate is None:

                candidate = find_best_position(
                    room,
                    placed_rooms,
                    usable_plot,
                    road_side,
                    strategy,
                    vastu_mode,
                )

            if candidate is None:

                errors.append(
                    "Could not place living room."
                )

                continue

            placed_rooms.append(candidate)

            continue

        # ----------------------------------------------------
        # Dining
        # ----------------------------------------------------

        if room_type == "dining":

            candidate = _place_adjacent_room(
                room,
                ["living_room"],
                placed_rooms,
                usable_plot,
                strategy=strategy,
                road_side=road_side,
                vastu_mode=vastu_mode,
            )

            if candidate is None:

                candidate = find_best_position(
                    room,
                    placed_rooms,
                    usable_plot,
                    road_side,
                    strategy,
                    vastu_mode,
                )

            if candidate is None:

                errors.append(
                    "Could not place dining room."
                )

                continue

            placed_rooms.append(
                candidate
            )

            continue

        # ----------------------------------------------------
        # Kitchen
        # ----------------------------------------------------

        if room_type == "kitchen":

            candidate = _place_adjacent_room(
                room,
                ["dining"],
                placed_rooms,
                usable_plot,
            )

            if candidate is None:

                candidate = _place_adjacent_room(
                    room,
                    ["living_room"],
                    placed_rooms,
                    usable_plot,
                )

            if candidate is None:

                candidate = find_best_position(
                    room,
                    placed_rooms,
                    usable_plot,
                    road_side,
                    strategy,
                    vastu_mode,
                )

            if candidate is None:

                errors.append(
                    "Could not place kitchen."
                )

                continue

            placed_rooms.append(
                candidate
            )

            continue

        # ----------------------------------------------------
        # Utility
        # ----------------------------------------------------

        if room_type == "utility":

            candidate = _place_adjacent_room(
                room,
                ["kitchen"],
                placed_rooms,
                usable_plot,
                strategy=strategy,
                road_side=road_side,
                vastu_mode=vastu_mode,
            )

            if candidate is None:

                candidate = find_best_position(
                    room,
                    placed_rooms,
                    usable_plot,
                    road_side,
                    strategy,
                    vastu_mode,
                )

            if candidate is None:

                errors.append(
                    "Could not place utility room."
                )

                continue

            placed_rooms.append(
                candidate
            )

            continue

        # ----------------------------------------------------
        # Ground staircase
        # ----------------------------------------------------

        if room_type == "staircase":

            candidate = _place_staircase(
                room,
                placed_rooms,
                usable_plot,
                strategy,
            )

            if candidate is None:
                errors.append(
                    "Could not place staircase without breaking common-room circulation."
                )
                continue

            placed_rooms.append(
                dict(candidate, **{
                    "staircase_role": candidate.get(
                        "staircase_role",
                        room.get("staircase_role", "ground"),
                    ),
                })
            )

            continue

        # ----------------------------------------------------
        # Master bedroom
        # ----------------------------------------------------

        if room_type == "master_bedroom":

            candidate = find_best_position(
                room,
                placed_rooms,
                usable_plot,
                road_side,
                strategy,
                vastu_mode,
            )

            if candidate is None:

                errors.append(
                    "Could not place master bedroom."
                )

                continue

            placed_rooms.append(
                candidate
            )

            continue

        # ----------------------------------------------------
        # Bedrooms
        # ----------------------------------------------------

        if room_type in {
            "bedroom",
            "guest_bedroom",
        }:

            private_anchors = [
                anchor_type
                for anchor_type in (
                    "master_bedroom",
                    "bedroom",
                    "guest_bedroom",
                )
            ]
            private_anchor_count = sum(
                anchor_type in private_anchors
                for anchor_type in (
                    placed_room["room_type"]
                    for placed_room in placed_rooms
                )
            )
            candidate = None
            if private_anchor_count >= 2:
                candidate = _place_adjacent_room(
                    room,
                    private_anchors,
                    placed_rooms,
                    usable_plot,
                    strategy=strategy,
                    road_side=road_side,
                    vastu_mode=vastu_mode,
                )
            if candidate is None:
                candidate = find_best_position(
                    room,
                    placed_rooms,
                    usable_plot,
                    road_side,
                    strategy,
                    vastu_mode,
                )

            if candidate is None:

                errors.append(
                    f"Could not place {room_type}."
                )

                continue

            placed_rooms.append(
                candidate
            )

            continue

        # ----------------------------------------------------
        # Bathroom
        # ----------------------------------------------------

        if room_type == "bathroom":

            private_anchors = [
                room.get("attached_to")
            ] if room.get("attached_to") else ([
                "master_bedroom",
                "bedroom",
                "guest_bedroom",
                "living_room",
                "dining",
                "staircase",
            ] if room.get("access_type") == "common" else [
                "master_bedroom",
                "bedroom",
                "guest_bedroom",
            ])

            candidate = _place_adjacent_room(
                room,
                private_anchors,
                placed_rooms,
                usable_plot,
                strategy=strategy,
                road_side=road_side,
                vastu_mode=vastu_mode,
            )

            if candidate is None:

                candidate = find_best_position(
                    room,
                    placed_rooms,
                    usable_plot,
                    road_side,
                    strategy,
                    vastu_mode,
                )

            if candidate is None:

                errors.append(
                    "Could not place bathroom."
                )

                continue

            placed_rooms.append(
                dict(candidate, **{
                    key: room[key]
                    for key in ("attached_to",)
                    if key in room
                })
            )

            continue

        # ----------------------------------------------------
        # Puja
        # ----------------------------------------------------

        if room_type == "puja_room":

            candidate = find_best_position(
                room,
                placed_rooms,
                usable_plot,
                road_side,
                strategy,
                vastu_mode,
            )

            if candidate is None:

                errors.append(
                    "Could not place puja room."
                )

                continue

            placed_rooms.append(
                candidate
            )

            continue

        # ----------------------------------------------------
        # Custom room
        # ----------------------------------------------------

        candidate = find_best_position(
            room,
            placed_rooms,
            usable_plot,
            road_side,
            strategy,
            vastu_mode,
        )

        if candidate is None:

            errors.append(
                f"Could not place {room_type}."
            )

            continue

        placed_rooms.append(
            candidate
        )

    # ========================================================
    # STAIRCASE — DELIBERATELY LAST
    # ========================================================

    for staircase in staircase_rooms:

        staircase_candidate = _place_staircase(
            staircase,
            placed_rooms,
            usable_plot,
            strategy,
        )

        if staircase_candidate is None:

            errors.append(
                "Could not place staircase "
                "without breaking common-room circulation."
            )

            continue

        placed_rooms.append(
                dict(staircase_candidate, **{
                    key: staircase[key]
                    for key in ("staircase_role",)
                    if key in staircase
                })
        )

    # ========================================================
    # FINAL ARCHITECTURAL CHECK
    # ========================================================

    architectural_errors = (
        _architectural_errors(
            placed_rooms
        )
    )

    for error in architectural_errors:

        if error not in errors:

            errors.append(
                error
            )

    # ========================================================
    # SCORES
    # ========================================================

    functional_score = (
        calculate_functional_score(
            placed_rooms
        )
    )

    distribution_score = (
        _distribution_score(
            placed_rooms,
            usable_plot,
            strategy,
        )
    )

    circulation_score = (
        _circulation_score(
            placed_rooms
        )
    )

    # --------------------------------------------------------
    # Road score.
    # --------------------------------------------------------

    road_scores = []

    for room in placed_rooms:

        if room["room_type"] in {
            "living_room",
            "dining",
        }:

            road_scores.append(
                _road_zone_score(
                    room,
                    usable_plot,
                    road_side,
                )
            )

    if road_scores:

        road_score = (
            sum(road_scores)
            / len(road_scores)
        )

    else:

        road_score = 50.0

    # ========================================================
    # FINAL FUNCTIONAL SCORE
    # ========================================================

    final_functional_score = round(
        functional_score * 0.45
        + distribution_score * 0.20
        + circulation_score * 0.20
        + road_score * 0.15,
        2,
    )

    # ========================================================
    # AREA
    # ========================================================

    used_area = round(
        sum(
            float(
                room.get(
                    "area",
                    0,
                )
            )
            for room in placed_rooms
        ),
        2,
    )

    _, _, plot_width, plot_length = (
        _plot_dimensions(
            usable_plot
        )
    )

    plot_area = (
        plot_width
        * plot_length
    )
    reserved_area = round(sum(
        float(region.get("width", 0)) * float(region.get("length", 0))
        for region in _reserved_regions(usable_plot)
    ), 2)

    remaining_area = round(
        max(
            0.0,
            plot_area
            - used_area
            - reserved_area,
        ),
        2,
    )

    # ========================================================
    # VALIDITY
    # ========================================================

    valid = (
        len(errors) == 0
        and len(placed_rooms)
        == len(rooms)
    )

    return {
        "rooms": placed_rooms,
        "usable_plot": usable_plot,
        "used_room_area": used_area,
        "remaining_area": remaining_area,
        "reserved_area": reserved_area,
        "functional_score": final_functional_score,
        "road_score": round(
            road_score,
            2,
        ),
        "distribution_score": round(
            distribution_score,
            2,
        ),
        "circulation_score": round(
            circulation_score,
            2,
        ),
        "valid": valid,
        "errors": errors,
        "strategy": strategy,
        "vastu_mode": vastu_mode,
        "topology": TOPOLOGY_PROFILES.get(
            strategy,
            "central",
        ),
    }


# ============================================================
# LEGACY OPTIMIZER
# ============================================================

def optimize_layout(
    rooms: List[Dict],
    usable_plot: Dict,
    road_side: str = "North",
    strategy: str = "balanced",
    vastu_mode: str = "basic",
) -> Dict:
    """
    Backward-compatible optimizer.

    Existing modules can continue calling
    optimize_layout().
    """

    return generate_zone_layout(
        rooms=rooms,
        usable_plot=usable_plot,
        road_side=road_side,
        strategy=strategy,
        vastu_mode=vastu_mode,
    )


# ============================================================
# ALTERNATIVE NAME
# ============================================================

def generate_layout(
    rooms: List[Dict],
    usable_plot: Dict,
    road_side: str = "North",
    strategy: str = "balanced",
    vastu_mode: str = "basic",
) -> Dict:
    """
    Convenience alias for generate_zone_layout().
    """

    return generate_zone_layout(
        rooms=rooms,
        usable_plot=usable_plot,
        road_side=road_side,
        strategy=strategy,
        vastu_mode=vastu_mode,
    )