from html import escape

from backend.planner.plot_rules import normalize_road_side


# ============================================================
# ROOM DISPLAY SETTINGS
# ============================================================

ROOM_LABELS = {
    "living_room": "LIVING ROOM",
    "dining": "DINING",
    "kitchen": "KITCHEN",
    "master_bedroom": "MASTER BEDROOM",
    "bedroom": "BEDROOM",
    "guest_bedroom": "GUEST BEDROOM",
    "bathroom": "BATHROOM",
    "utility": "UTILITY",
    "puja_room": "PUJA",
    "staircase": "STAIRCASE",
}

ROOM_FILLS = {
    "living_room": "#f4eadb",
    "dining": "#f4eadb",
    "master_bedroom": "#f1e5d5",
    "bedroom": "#f1e5d5",
    "guest_bedroom": "#f1e5d5",
    "kitchen": "url(#tile-pattern)",
    "bathroom": "url(#bath-pattern)",
    "utility": "url(#tile-pattern)",
    "puja_room": "#f7efd9",
    "staircase": "#e9e5df",
}


OPEN_SPACE_LABELS = {
    "front_open_space": "FRONT OPEN SPACE",
    "rear_open_space": "REAR OPEN SPACE",
    "side_open_space": "SIDE OPEN SPACE",
    "courtyard": "COURTYARD",
    "circulation": "CIRCULATION",
    "future_expansion": "FUTURE EXPANSION",
}


# ============================================================
# STAIRCASE DRAWING
# ============================================================

def staircase_svg(
    x,
    y,
    width,
    height,
    scale=12,
    role="ground",
):
    """
    Draw a realistic-looking staircase inside the staircase room.

    The staircase is represented using:
        - Stair enclosure
        - Individual treads
        - Direction arrow
        - UP indicator
    """

    elements = []

    # --------------------------------------------------------
    # Padding inside staircase room
    # --------------------------------------------------------

    padding_x = width * 0.15
    padding_y = height * 0.08

    stair_x = x + padding_x
    stair_y = y + padding_y

    stair_width = width - (2 * padding_x)
    stair_height = height - (2 * padding_y)

    # Prevent extremely small geometry
    stair_width = max(stair_width, 30)
    stair_height = max(stair_height, 50)

    elements.append(f'<rect x="{stair_x}" y="{stair_y}" width="{stair_width}" height="{stair_height}" fill="none" stroke="#444" stroke-width="2"/>')

    if role == "arrival":
        arrow_x = stair_x + stair_width / 2
        arrow_y = stair_y + stair_height * 0.48
        elements.append(f'<line x1="{arrow_x}" y1="{arrow_y - 18}" x2="{arrow_x}" y2="{arrow_y + 18}" stroke="#222" stroke-width="2.5"/>')
        elements.append(f'<polygon points="{arrow_x},{arrow_y + 18} {arrow_x - 6},{arrow_y + 8} {arrow_x + 6},{arrow_y + 8}" fill="#222"/>')
        elements.append(f'<text x="{arrow_x}" y="{stair_y + stair_height * 0.35}" text-anchor="middle" font-family="Arial" font-size="11" font-weight="bold">ARRIVAL</text>')
        return "\n".join(elements)

    landing_height = stair_height * 0.20
    flight_height = (stair_height - landing_height) / 2
    half_width = stair_width / 2
    landing_y = stair_y + flight_height
    elements.append(f'<rect x="{stair_x}" y="{landing_y}" width="{stair_width}" height="{landing_height}" fill="#d8d2c8" stroke="#444" stroke-width="1.5"/>')

    for flight_x, flight_y, flight_w, flight_h, reverse in (
        (stair_x, stair_y, half_width, flight_height, False),
        (stair_x + half_width, landing_y + landing_height, half_width, flight_height, True),
    ):
        tread_count = 8
        for index in range(tread_count + 1):
            current_y = flight_y + index * flight_h / tread_count
            elements.append(f'<line x1="{flight_x}" y1="{current_y}" x2="{flight_x + flight_w}" y2="{current_y}" stroke="#666" stroke-width="1.2"/>')
        arrow_x = flight_x + flight_w / 2
        arrow_start = flight_y + flight_h * 0.78 if not reverse else flight_y + flight_h * 0.22
        arrow_end = flight_y + flight_h * 0.22 if not reverse else flight_y + flight_h * 0.78
        elements.append(f'<line x1="{arrow_x}" y1="{arrow_start}" x2="{arrow_x}" y2="{arrow_end}" stroke="#222" stroke-width="2.5"/>')
        head_y = arrow_end
        elements.append(f'<polygon points="{arrow_x},{head_y} {arrow_x - 5},{head_y + (8 if not reverse else -8)} {arrow_x + 5},{head_y + (8 if not reverse else -8)}" fill="#222"/>')

    # --------------------------------------------------------
    # Stair direction arrow
    # --------------------------------------------------------

    elements.append(
        f'<text x="{stair_x + stair_width / 2}" y="{stair_y + stair_height * 0.56}" text-anchor="middle" font-family="Arial" font-size="11" font-weight="bold">UP</text>'
    )

    return "\n".join(elements)


# ============================================================
# FURNITURE
# ============================================================

def furniture_svg(
    room_type,
    x,
    y,
    width,
    height,
    scale
):
    """Draw deterministic top-view architectural symbols inside one room."""

    elements = []
    stroke = "#5f5b55"
    light = "#eeeae3"
    wood = "#b4875b"
    green = "#6c9a63"

    def planter(px, py, radius):
        return (
            f'<circle cx="{px}" cy="{py}" r="{radius}" fill="#c3a477" stroke="#6f583a" stroke-width="1.2"/>'
            f'<path d="M{px},{py + radius * 0.2} C{px - radius * 1.5},{py - radius * 1.8} {px - radius * 1.8},{py - radius * 0.8} {px - radius * 0.4},{py - radius * 0.4}" fill="none" stroke="{green}" stroke-width="2"/>'
            f'<path d="M{px},{py + radius * 0.2} C{px + radius * 1.5},{py - radius * 1.8} {px + radius * 1.8},{py - radius * 0.8} {px + radius * 0.4},{py - radius * 0.4}" fill="none" stroke="{green}" stroke-width="2"/>'
        )

    if room_type == "living_room":
        sofa_x, sofa_y = x + width * 0.12, y + height * 0.16
        sofa_w, sofa_h = width * 0.52, height * 0.27
        elements.append(
            f'<rect x="{sofa_x}" y="{sofa_y}" width="{sofa_w}" height="{sofa_h}" rx="{min(width, height) * 0.05}" fill="#ddd8cf" stroke="{stroke}" stroke-width="1.5"/>'
            f'<path d="M{sofa_x + sofa_w * 0.08},{sofa_y + sofa_h * 0.30} H{sofa_x + sofa_w * 0.92}" stroke="#9d9387" stroke-width="2"/>'
            f'<line x1="{sofa_x + sofa_w * 0.34}" y1="{sofa_y + sofa_h * 0.38}" x2="{sofa_x + sofa_w * 0.34}" y2="{sofa_y + sofa_h * 0.92}" stroke="#aaa096"/>'
            f'<line x1="{sofa_x + sofa_w * 0.67}" y1="{sofa_y + sofa_h * 0.38}" x2="{sofa_x + sofa_w * 0.67}" y2="{sofa_y + sofa_h * 0.92}" stroke="#aaa096"/>'
            f'<rect x="{sofa_x - sofa_w * 0.06}" y="{sofa_y}" width="{sofa_w * 0.08}" height="{sofa_h}" rx="4" fill="#c7c0b6" stroke="{stroke}"/>'
            f'<rect x="{sofa_x + sofa_w * 0.98}" y="{sofa_y}" width="{sofa_w * 0.08}" height="{sofa_h}" rx="4" fill="#c7c0b6" stroke="{stroke}"/>'
        )
        table_x, table_y = x + width * 0.27, y + height * 0.57
        elements.append(f'<ellipse cx="{table_x + width * 0.13}" cy="{table_y + height * 0.07}" rx="{width * 0.13}" ry="{height * 0.07}" fill="#e4ded5" stroke="{stroke}"/><line x1="{table_x + width * 0.07}" y1="{table_y + height * 0.07}" x2="{table_x + width * 0.19}" y2="{table_y + height * 0.07}" stroke="#9d9387"/>')
        tv_x, tv_y = x + width * 0.75, y + height * 0.12
        elements.append(f'<rect x="{tv_x}" y="{tv_y}" width="{width * 0.16}" height="{height * 0.05}" rx="2" fill="#4d5960" stroke="#222"/><rect x="{tv_x - width * 0.02}" y="{tv_y + height * 0.06}" width="{width * 0.20}" height="{height * 0.06}" fill="{wood}" stroke="{stroke}"/>')
        elements.append(planter(x + width * 0.88, y + height * 0.78, min(width, height) * 0.045))

    elif room_type in {"master_bedroom", "bedroom", "guest_bedroom"}:
        bed_x, bed_y = x + width * 0.24, y + height * 0.25
        bed_w, bed_h = width * 0.48, height * 0.38
        elements.append(f'<path d="M{bed_x - bed_w * 0.04},{bed_y + bed_h * 0.08} Q{bed_x - bed_w * 0.04},{bed_y - bed_h * 0.08} {bed_x + bed_w * 0.08},{bed_y - bed_h * 0.08} H{bed_x + bed_w * 0.92} Q{bed_x + bed_w * 1.04},{bed_y - bed_h * 0.08} {bed_x + bed_w * 1.04},{bed_y + bed_h * 0.08} V{bed_y + bed_h * 0.12} H{bed_x - bed_w * 0.04} Z" fill="{wood}" stroke="#6f5038" stroke-width="1.3"/>')
        elements.append(f'<rect x="{bed_x}" y="{bed_y}" width="{bed_w}" height="{bed_h}" rx="{min(width, height) * 0.035}" fill="{light}" stroke="{stroke}" stroke-width="1.5"/><path d="M{bed_x + bed_w * 0.06},{bed_y + bed_h * 0.60} H{bed_x + bed_w * 0.94}" stroke="#c4b6a5" stroke-width="2"/>')
        pillow_w, pillow_h = bed_w * 0.30, bed_h * 0.18
        for pillow_x in (bed_x + bed_w * 0.10, bed_x + bed_w * 0.60):
            elements.append(f'<rect x="{pillow_x}" y="{bed_y + bed_h * 0.10}" width="{pillow_w}" height="{pillow_h}" rx="{pillow_h * 0.35}" fill="white" stroke="#8b8176"/>')
        side = min(width, height) * 0.09
        for side_x in (bed_x - side * 1.35, bed_x + bed_w + side * 0.35):
            elements.append(f'<rect x="{side_x}" y="{bed_y + bed_h * 0.18}" width="{side}" height="{side}" rx="2" fill="#d8d0c5" stroke="{stroke}"/><circle cx="{side_x + side / 2}" cy="{bed_y + bed_h * 0.18 + side / 2}" r="{side * 0.08}" fill="{stroke}"/>')
        wardrobe_x, wardrobe_y = x + width * 0.08, y + height * 0.76
        wardrobe_w, wardrobe_h = width * 0.30, height * 0.13
        elements.append(f'<rect x="{wardrobe_x}" y="{wardrobe_y}" width="{wardrobe_w}" height="{wardrobe_h}" fill="#d3cbc0" stroke="{stroke}"/><line x1="{wardrobe_x + wardrobe_w / 2}" y1="{wardrobe_y}" x2="{wardrobe_x + wardrobe_w / 2}" y2="{wardrobe_y + wardrobe_h}" stroke="{stroke}"/><circle cx="{wardrobe_x + wardrobe_w * 0.45}" cy="{wardrobe_y + wardrobe_h / 2}" r="1.5" fill="{stroke}"/><circle cx="{wardrobe_x + wardrobe_w * 0.55}" cy="{wardrobe_y + wardrobe_h / 2}" r="1.5" fill="{stroke}"/>')

    elif room_type == "dining":
        table_x, table_y = x + width * 0.23, y + height * 0.29
        table_w, table_h = width * 0.54, height * 0.30
        elements.append(f'<rect x="{table_x}" y="{table_y}" width="{table_w}" height="{table_h}" rx="{min(width, height) * 0.07}" fill="#d8c5ae" stroke="{stroke}" stroke-width="1.5"/><line x1="{table_x + table_w * 0.18}" y1="{table_y + table_h * 0.18}" x2="{table_x + table_w * 0.82}" y2="{table_y + table_h * 0.18}" stroke="#b39678"/><line x1="{table_x + table_w * 0.18}" y1="{table_y + table_h * 0.82}" x2="{table_x + table_w * 0.82}" y2="{table_y + table_h * 0.82}" stroke="#b39678"/>')
        chair_w, chair_h = width * 0.12, height * 0.10
        chairs = [(table_x + table_w * 0.18, table_y - chair_h * 1.35), (table_x + table_w * 0.70, table_y - chair_h * 1.35), (table_x + table_w * 0.18, table_y + table_h + chair_h * 0.35), (table_x + table_w * 0.70, table_y + table_h + chair_h * 0.35), (table_x - chair_w * 1.25, table_y + table_h * 0.30), (table_x + table_w + chair_w * 0.25, table_y + table_h * 0.30)]
        for chair_x, chair_y in chairs:
            elements.append(f'<rect x="{chair_x}" y="{chair_y}" width="{chair_w}" height="{chair_h}" rx="3" fill="#ddd5ca" stroke="{stroke}"/><line x1="{chair_x + chair_w * 0.18}" y1="{chair_y + chair_h * 0.22}" x2="{chair_x + chair_w * 0.82}" y2="{chair_y + chair_h * 0.22}" stroke="#a99a88"/>')

    elif room_type == "kitchen":
        counter_x, counter_y = x + width * 0.08, y + height * 0.12
        counter_w, counter_h = width * 0.84, height * 0.15
        elements.append(f'<path d="M{counter_x},{counter_y + counter_h} V{counter_y} H{counter_x + counter_w} V{counter_y + counter_h}" fill="none" stroke="#81786e" stroke-width="{max(2, min(width, height) * 0.035)}"/><line x1="{counter_x + counter_w * 0.33}" y1="{counter_y}" x2="{counter_x + counter_w * 0.33}" y2="{counter_y + counter_h}" stroke="#aaa096"/><line x1="{counter_x + counter_w * 0.66}" y1="{counter_y}" x2="{counter_x + counter_w * 0.66}" y2="{counter_y + counter_h}" stroke="#aaa096"/>')
        sink_x, sink_y = counter_x + counter_w * 0.48, counter_y + counter_h * 0.18
        elements.append(f'<rect x="{sink_x}" y="{sink_y}" width="{counter_w * 0.18}" height="{counter_h * 0.62}" rx="3" fill="none" stroke="#4a90a4"/><path d="M{sink_x + counter_w * 0.09},{sink_y - counter_h * 0.05} v{counter_h * 0.18}" stroke="#4a90a4"/>')
        for burner_x in (counter_x + counter_w * 0.15, counter_x + counter_w * 0.25):
            elements.append(f'<circle cx="{burner_x}" cy="{counter_y + counter_h * 0.50}" r="{min(width, height) * 0.035}" fill="none" stroke="#555"/><circle cx="{burner_x}" cy="{counter_y + counter_h * 0.50}" r="{min(width, height) * 0.012}" fill="#555"/>')
        fridge_x, fridge_y = x + width * 0.72, y + height * 0.48
        elements.append(f'<rect x="{fridge_x}" y="{fridge_y}" width="{width * 0.18}" height="{height * 0.34}" rx="3" fill="#e8eef0" stroke="{stroke}"/><line x1="{fridge_x}" y1="{fridge_y + height * 0.17}" x2="{fridge_x + width * 0.18}" y2="{fridge_y + height * 0.17}" stroke="{stroke}"/><line x1="{fridge_x + width * 0.14}" y1="{fridge_y + height * 0.08}" x2="{fridge_x + width * 0.14}" y2="{fridge_y + height * 0.13}" stroke="{stroke}"/>')

    elif room_type == "bathroom":
        toilet_x, toilet_y = x + width * 0.25, y + height * 0.27
        elements.append(f'<rect x="{toilet_x - width * 0.09}" y="{toilet_y - height * 0.10}" width="{width * 0.18}" height="{height * 0.08}" rx="2" fill="#f4f5f2" stroke="{stroke}"/><ellipse cx="{toilet_x}" cy="{toilet_y + height * 0.04}" rx="{width * 0.10}" ry="{height * 0.13}" fill="#f4f5f2" stroke="{stroke}"/><ellipse cx="{toilet_x}" cy="{toilet_y + height * 0.05}" rx="{width * 0.045}" ry="{height * 0.065}" fill="none" stroke="#aaa096"/>')
        basin_x, basin_y = x + width * 0.72, y + height * 0.24
        elements.append(f'<ellipse cx="{basin_x}" cy="{basin_y}" rx="{width * 0.12}" ry="{height * 0.08}" fill="#f4f5f2" stroke="#4a90a4"/><circle cx="{basin_x}" cy="{basin_y}" r="{min(width, height) * 0.018}" fill="#4a90a4"/>')
        shower_x, shower_y = x + width * 0.52, y + height * 0.70
        elements.append(f'<rect x="{x + width * 0.35}" y="{y + height * 0.54}" width="{width * 0.45}" height="{height * 0.34}" fill="none" stroke="#4a90a4" stroke-dasharray="3,2"/><circle cx="{shower_x}" cy="{shower_y}" r="{min(width, height) * 0.035}" fill="none" stroke="#4a90a4"/><circle cx="{shower_x}" cy="{shower_y}" r="{min(width, height) * 0.012}" fill="#4a90a4"/>')

    elif room_type == "utility":
        counter_y = y + height * 0.15
        elements.append(f'<path d="M{x + width * 0.08},{counter_y + height * 0.12} H{x + width * 0.85}" stroke="#81786e" stroke-width="{max(2, min(width, height) * 0.035)}"/><line x1="{x + width * 0.40}" y1="{counter_y}" x2="{x + width * 0.40}" y2="{counter_y + height * 0.20}" stroke="#aaa096"/>')
        mx, my, ms = x + width * 0.20, y + height * 0.43, min(width, height) * 0.28
        elements.append(f'<rect x="{mx}" y="{my}" width="{ms}" height="{ms}" rx="4" fill="#e6e8e6" stroke="{stroke}"/><circle cx="{mx + ms / 2}" cy="{my + ms / 2}" r="{ms * 0.30}" fill="none" stroke="#4a90a4" stroke-width="2"/><circle cx="{mx + ms / 2}" cy="{my + ms / 2}" r="{ms * 0.06}" fill="#4a90a4"/>')

    return "\n".join(elements)


# ============================================================
# ROOM DRAWING
# ============================================================

def room_svg(
    room,
    scale,
    origin_x,
    origin_y
):
    """
    Convert one room into SVG.
    """

    x = origin_x + room["x"] * scale
    y = origin_y + room["y"] * scale

    width = room["width"] * scale
    height = room["length"] * scale

    room_type = room["room_type"]

    label = str(room.get("name") or "").upper() or ROOM_LABELS.get(
        room_type,
        room_type.replace("_", " ").upper()
    )

    elements = []

    # --------------------------------------------------------
    # Room boundary
    # --------------------------------------------------------

    clip_id = (
        "room-clip-"
        + room_type.replace("_", "-")
        + "-"
        + str(int(room["x"] * 100))
        + "-"
        + str(int(room["y"] * 100))
    )
    elements.append(
        f"""
        <defs><clipPath id="{clip_id}">
            <rect x="{x}" y="{y}" width="{width}" height="{height}"/>
        </clipPath></defs>
        <rect
            x="{x}"
            y="{y}"
            width="{width}"
            height="{height}"
            fill="{ROOM_FILLS.get(room_type, '#f7f7f5')}"
            stroke="#8b8176"
            stroke-width="2.5"
            filter="url(#room-shadow)"
        />
        """
    )

    # --------------------------------------------------------
    # Staircase
    # --------------------------------------------------------

    if room_type == "staircase":

        elements.append(
            staircase_svg(
                x=x,
                y=y,
                width=width,
                height=height,
                scale=scale,
                role=room.get("staircase_role", "ground"),
            )
        )

    else:

        # ----------------------------------------------------
        # Normal furniture
        # ----------------------------------------------------

        elements.append(
            f'<g clip-path="url(#{clip_id})">'
            + furniture_svg(
                room_type,
                x,
                y,
                width,
                height,
                scale
            )
            + "</g>"
        )

    # --------------------------------------------------------
    # Room label
    # --------------------------------------------------------

    font_size = max(
        10,
        min(width, height) * 0.055
    )

    # Staircase label gets slightly smaller because
    # staircase already contains UP text.

    if room_type == "staircase":
        label_y = y + height - 10
    else:
        label_y = y + height - 12

    elements.append(
        f"""
        <text
            x="{x + width / 2}"
            y="{label_y}"
            text-anchor="middle"
            font-family="Arial"
            font-size="{font_size}"
            font-weight="bold"
            fill="#222"
        >
            {escape(label)}
        </text>
        """
    )

    # --------------------------------------------------------
    # Dimensions
    # --------------------------------------------------------

    dimension_size = max(
        8,
        font_size * 0.75
    )

    elements.append(
        f"""
        <text
            x="{x + width / 2}"
            y="{y + 16}"
            text-anchor="middle"
            font-family="Arial"
            font-size="{dimension_size}"
            fill="#555"
        >
            {room["width"]} × {room["length"]} ft
        </text>
        """
    )

    return "\n".join(elements)


def openings_svg(openings, rooms, scale, origin_x, origin_y):
    """Draw doors and windows on top of room boundaries."""
    if not openings:
        return ""
    room_map = {r.get("room_type"): r for r in rooms}
    room_map.update({r["id"]: r for r in rooms if r.get("id")})
    elements = []

    def wall_segment(room, wall, position, width):
        x = origin_x + room["x"] * scale
        y = origin_y + room["y"] * scale
        w = room["width"] * scale
        h = room["length"] * scale
        pos = float(position) * scale
        opening = max(12.0, float(width) * scale)
        if wall == "top":
            return x + pos, y, x + pos + opening, y
        if wall == "bottom":
            return x + pos, y + h, x + pos + opening, y + h
        if wall == "left":
            return x, y + pos, x, y + pos + opening
        return x + w, y + pos, x + w, y + pos + opening

    for door in openings.get("doors", []):
        room_name = door.get("room") or door.get("room_a")
        room = room_map.get(room_name)
        if not room:
            continue
        wall = door.get("wall") or door.get("wall_a")
        if not wall:
            continue
        x1, y1, x2, y2 = wall_segment(
            room, wall, door.get("position", 0), door.get("width", 3)
        )
        main_door = door.get("door_type") == "main"
        color = "#9a6842" if main_door else "#7d746b"
        leaf_width = 2.2 if main_door else 1.6
        if wall in {"top", "bottom"}:
            inward = 1 if wall == "top" else -1
            leaf_x2, leaf_y2 = x1, y1 + inward * (x2 - x1)
            control_x, control_y = x1 + (x2 - x1) * 0.52, y1 + inward * (x2 - x1) * 0.92
        else:
            inward = 1 if wall == "left" else -1
            leaf_x2, leaf_y2 = x1 + inward * (y2 - y1), y1
            control_x, control_y = x1 + inward * (y2 - y1) * 0.92, y1 + (y2 - y1) * 0.52
        elements.append(
            f'<line data-opening="door-gap" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            'stroke="#fffaf0" stroke-width="5"/>'
        )
        elements.append(
            f'<line data-opening="door-leaf" x1="{x1}" y1="{y1}" x2="{leaf_x2}" y2="{leaf_y2}" '
            f'stroke="{color}" stroke-width="{leaf_width}"/>'
        )
        elements.append(
            f'<path data-opening="door-swing" d="M{x2},{y2} Q{control_x},{control_y} {leaf_x2},{leaf_y2}" '
            f'fill="none" stroke="{color}" stroke-width="1.2"/>'
        )

    for window in openings.get("windows", []):
        room = room_map.get(window.get("room"))
        if not room:
            continue
        x1, y1, x2, y2 = wall_segment(
            room, window.get("wall", "top"),
            window.get("position", 0), window.get("width", 3)
        )
        dx, dy = x2 - x1, y2 - y1
        length = max((dx * dx + dy * dy) ** 0.5, 1.0)
        normal_x, normal_y = -dy / length, dx / length
        frame_offset = 3.0
        frame_lines = []
        for offset in (-frame_offset, 0.0, frame_offset):
            start_x = x1 + normal_x * offset
            start_y = y1 + normal_y * offset
            end_x = x2 + normal_x * offset
            end_y = y2 + normal_y * offset
            frame_lines.append(
                f'<line x1="{start_x}" y1="{start_y}" x2="{end_x}" y2="{end_y}" '
                'stroke="#4a90a4" stroke-width="1.2"/>'
            )
        elements.append(
            f'<g data-opening="window-frame">{"".join(frame_lines)}</g>'
        )

    return "\n".join(elements)


def parking_svg(usable_plot, scale, origin_x, origin_y):
    elements = []
    for index, parking in enumerate(usable_plot.get("reserved_regions", [])):
        x = origin_x + parking["x"] * scale
        y = origin_y + parking["y"] * scale
        width = parking["width"] * scale
        height = parking["length"] * scale
        elements.append(
            f'<rect x="{x}" y="{y}" width="{width}" height="{height}" '
            'fill="url(#parking-pattern)" stroke="#9a9186" stroke-width="1.5"/>'
        )
        bays = parking.get("bays") or []
        for bay in bays:                                   # the marked car bays (the same ones the 3D model parks in)
            bx = origin_x + bay["x"] * scale
            by = origin_y + bay["y"] * scale
            elements.append(
                f'<rect data-parking-bay="{bay["index"]}" x="{bx}" y="{by}" width="{bay["width"] * scale}" '
                f'height="{bay["length"] * scale}" fill="none" stroke="#f4f1ea" stroke-width="2" stroke-dasharray="7 5"/>'
            )
        if bays:                                           # the car stands in the first bay (turned when the road is east / west)
            b0 = bays[0]
            bx, by = origin_x + b0["x"] * scale, origin_y + b0["y"] * scale
            bw, bh = b0["width"] * scale, b0["length"] * scale
        else:
            bx, by, bw, bh = x, y, width, height
        turned = bw > bh
        long_side, short_side = (bw, bh) if turned else (bh, bw)
        if short_side >= 70 and long_side >= 120 or (not bays and width >= 90 and height >= 150):
            car_s = min(short_side * 0.55, 70)
            car_l = min(long_side * 0.72, 130)
            car_w, car_h = (car_l, car_s) if turned else (car_s, car_l)
            car_x = bx + (bw - car_w) / 2
            car_y = by + (bh - car_h) / 2
            glass_w, glass_h = (car_w * 0.24, car_h * 0.68) if turned else (car_w * 0.68, car_h * 0.24)
            glass_x = car_x + (car_w * 0.60 if turned else car_w * 0.16)
            glass_y = car_y + (car_h * 0.16 if turned else car_h * 0.16)
            elements.append(
                f'<g data-parking="{index}"><rect x="{car_x}" y="{car_y}" '
                f'width="{car_w}" height="{car_h}" rx="10" fill="#b9c7cf" stroke="#63727b" stroke-width="1.5"/>'
                f'<rect x="{glass_x}" y="{glass_y}" '
                f'width="{glass_w}" height="{glass_h}" rx="4" fill="#e9f0f2" stroke="#74858e"/>'
                '</g>'
            )
    return "\n".join(elements)


# ============================================================
# NORTH ARROW
# ============================================================

def north_arrow_svg(x, y):

    return f"""
    <g>

        <text
            x="{x}"
            y="{y - 20}"
            text-anchor="middle"
            font-family="Arial"
            font-size="18"
            font-weight="bold"
        >
            N
        </text>

        <line
            x1="{x}"
            y1="{y + 35}"
            x2="{x}"
            y2="{y - 10}"
            stroke="#222"
            stroke-width="3"
        />

        <polygon
            points="
                {x},{y - 10}
                {x - 8},{y + 8}
                {x + 8},{y + 8}
            "
            fill="#222"
        />

    </g>
    """


# ============================================================
# ROAD
# ============================================================

def road_svg(
    plot_x,
    plot_y,
    plot_width,
    plot_length,
    scale,
    road_side
):
    try:
        road_side = normalize_road_side(road_side)
    except ValueError:
        return ""

    x = plot_x * scale
    y = plot_y * scale

    width = plot_width * scale
    height = plot_length * scale

    road_size = 45

    # --------------------------------------------------------
    # NORTH
    # --------------------------------------------------------

    if road_side == "North":

        return f"""
        <rect
            x="{x}"
            y="{y - road_size}"
            width="{width}"
            height="{road_size}"
            fill="#eeeeee"
            stroke="#777"
        />

        <text
            x="{x + width / 2}"
            y="{y - 17}"
            text-anchor="middle"
            font-family="Arial"
            font-size="16"
            font-weight="bold"
        >
            ROAD — NORTH
        </text>
        """

    # --------------------------------------------------------
    # SOUTH
    # --------------------------------------------------------

    if road_side == "South":

        return f"""
        <rect
            x="{x}"
            y="{y + height}"
            width="{width}"
            height="{road_size}"
            fill="#eeeeee"
            stroke="#777"
        />

        <text
            x="{x + width / 2}"
            y="{y + height + 28}"
            text-anchor="middle"
            font-family="Arial"
            font-size="16"
            font-weight="bold"
        >
            ROAD — SOUTH
        </text>
        """

    # --------------------------------------------------------
    # EAST
    # --------------------------------------------------------

    if road_side == "East":

        return f"""
        <rect
            x="{x + width}"
            y="{y}"
            width="{road_size}"
            height="{height}"
            fill="#eeeeee"
            stroke="#777"
        />

        <text
            x="{x + width + 30}"
            y="{y + height / 2}"
            text-anchor="middle"
            font-family="Arial"
            font-size="16"
            font-weight="bold"
            transform="
                rotate(
                    90
                    {x + width + 30}
                    {y + height / 2}
                )
            "
        >
            ROAD — EAST
        </text>
        """

    # --------------------------------------------------------
    # WEST
    # --------------------------------------------------------

    if road_side == "West":

        return f"""
        <rect
            x="{x - road_size}"
            y="{y}"
            width="{road_size}"
            height="{height}"
            fill="#eeeeee"
            stroke="#777"
        />

        <text
            x="{x - 30}"
            y="{y + height / 2}"
            text-anchor="middle"
            font-family="Arial"
            font-size="16"
            font-weight="bold"
            transform="
                rotate(
                    -90
                    {x - 30}
                    {y + height / 2}
                )
            "
        >
            ROAD — WEST
        </text>
        """

    return ""


# ============================================================
# OPEN SPACE DRAWING
# ============================================================

def open_space_svg(
    open_spaces,
    scale,
    origin_x,
    origin_y,
    usable_plot
):
    """Draw analyzed open-space regions beneath the room graphics."""
    if not open_spaces:
        return ""

    regions = open_spaces.get("regions", [])
    if not regions:
        return ""

    plot_x = float(usable_plot["x"])
    plot_y = float(usable_plot["y"])
    plot_x2 = plot_x + float(usable_plot["width"])
    plot_y2 = plot_y + float(usable_plot["length"])
    elements = [
        """
        <defs>
            <pattern
                id="open-space-hatch"
                width="8"
                height="8"
                patternUnits="userSpaceOnUse"
            >
                <path
                    d="M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6"
                    stroke="#c7c7c7"
                    stroke-width="1"
                />
            </pattern>
        </defs>
        """
    ]

    for region in regions:
        left = max(plot_x, float(region.get("x", plot_x)))
        bottom = max(plot_y, float(region.get("y", plot_y)))
        right = min(
            plot_x2,
            float(region.get("x", plot_x))
            + float(region.get("width", 0))
        )
        top = min(
            plot_y2,
            float(region.get("y", plot_y))
            + float(region.get("length", 0))
        )

        if right <= left or top <= bottom:
            continue

        x = origin_x + left * scale
        y = origin_y + bottom * scale
        width = (right - left) * scale
        height = (top - bottom) * scale
        region_type = region.get("type", "open_space")
        label = OPEN_SPACE_LABELS.get(
            region_type,
            region_type.replace("_", " ").upper()
        )
        font_size = max(8, min(14, min(width, height) * 0.14))
        dimension_size = max(7, min(10, font_size * 0.72))
        label_y = y + height / 2
        fill = {
            "courtyard": "#dce8d2",
            "front_open_space": "#dfead7",
            "rear_open_space": "#dfead7",
            "side_open_space": "#e5eddc",
            "circulation": "#eee8dd",
            "future_expansion": "#f1eee8",
        }.get(region_type, "url(#open-space-hatch)")

        elements.append(
            f"""
            <rect
                x="{x}"
                y="{y}"
                width="{width}"
                height="{height}"
                fill="{fill}"
                fill-opacity="0.72"
                stroke="#b8b8b8"
                stroke-width="1"
                stroke-dasharray="3,3"
            />
            <rect x="{x}" y="{y}" width="{width}" height="{height}"
                fill="url(#open-space-hatch)" fill-opacity="0.12" stroke="none"/>
            <text
                x="{x + width / 2}"
                y="{label_y}"
                text-anchor="middle"
                dominant-baseline="middle"
                font-family="Arial"
                font-size="{font_size}"
                font-weight="bold"
                fill="#666"
            >
                {escape(label)}
            </text>
            """
        )

        if width >= 48 and height >= 32:
            elements.append(
                f"""
                <text
                    x="{x + width / 2}"
                    y="{label_y + font_size + 3}"
                    text-anchor="middle"
                    font-family="Arial"
                    font-size="{dimension_size}"
                    fill="#777"
                >
                    {float(right - left):g} × {float(top - bottom):g} ft
                </text>
                """
            )

    return "\n".join(elements)


def feature_svg(layout, scale, origin_x, origin_y):
    """Render real outdoor and terrace feature geometry from layout metadata."""
    elements = []

    def rectangle(data, fill, stroke, label):
        if not data or not data.get("exists", True):
            return
        x = origin_x + data["x"] * scale
        y = origin_y + data["y"] * scale
        width = data["width"] * scale
        height = data["length"] * scale
        elements.append(
            f'<rect x="{x}" y="{y}" width="{width}" height="{height}" '
            f'fill="{fill}" fill-opacity="0.72" stroke="{stroke}" stroke-width="2" stroke-dasharray="5,3"/>'
            f'<text x="{x + width / 2}" y="{y + height / 2}" text-anchor="middle" '
            f'font-family="Arial" font-size="11" font-weight="bold">{label}</text>'
        )

    rectangle(layout.get("balcony"), "#d9e8d3", "#668a5d", "BALCONY")
    rectangle(layout.get("garden"), "#b9d6aa", "#557b4d", "GARDEN")

    garden = layout.get("garden")
    if garden and garden.get("exists"):
        x = origin_x + garden["x"] * scale
        y = origin_y + garden["y"] * scale
        for offset_x, offset_y in ((0.25, 0.3), (0.65, 0.65), (0.75, 0.25)):
            elements.append(
                f'<circle cx="{x + garden["width"] * scale * offset_x}" '
                f'cy="{y + garden["length"] * scale * offset_y}" r="6" fill="#5f9956" stroke="#3d6e39"/>'
            )

    balcony = layout.get("balcony")
    if balcony and balcony.get("exists"):
        x = origin_x + balcony["x"] * scale
        y = origin_y + balcony["y"] * scale
        width = balcony["width"] * scale
        height = balcony["length"] * scale
        elements.append(f'<line x1="{x}" y1="{y + height}" x2="{x + width}" y2="{y + height}" stroke="#668a5d" stroke-width="3"/>')
        elements.append(f'<line x1="{x + width * 0.45}" y1="{y + height}" x2="{x + width * 0.45}" y2="{y + height * 0.65}" stroke="#8b8176" stroke-width="3"/>')

    terrace = layout.get("terrace")
    if terrace and terrace.get("exists"):
        rectangle(terrace, "#e5e0d4", "#8b8176", "TERRACE")
        panels = terrace.get("solar_panels")
        if panels:
            x = origin_x + panels["x"] * scale
            y = origin_y + panels["y"] * scale
            width = panels["width"] * scale
            height = panels["length"] * scale
            elements.append(f'<rect x="{x}" y="{y}" width="{width}" height="{height}" fill="#527b9b" stroke="#29495f" stroke-width="2"/>')
            for index in range(1, 4):
                elements.append(f'<line x1="{x + width * index / 4}" y1="{y}" x2="{x + width * index / 4}" y2="{y + height}" stroke="#dce8ef" stroke-width="1"/>')
            elements.append(f'<text x="{x + width / 2}" y="{y + height / 2}" text-anchor="middle" font-family="Arial" font-size="10" fill="white">SOLAR</text>')
        terrace_garden = terrace.get("garden")
        if terrace_garden:
            rectangle(terrace_garden, "#b9d6aa", "#557b4d", "TERRACE GARDEN")

    return "\n".join(elements)


# ============================================================
# MAIN SVG RENDERER
# ============================================================

def render_floor_plan(
    layout,
    plot,
    usable_plot,
    road_side="North"
):
    """
    Render the complete floor plan as SVG.

    Includes:
        - Plot boundary
        - Setback boundary
        - Road
        - Rooms
        - Furniture
        - Staircase
        - North arrow
        - Dimensions
        - Title

    Returns:
        SVG string
    """

    try:
        road_side = normalize_road_side(road_side)
    except ValueError:
        return "<svg></svg>"

    rooms = layout.get(
        "rooms",
        []
    )

    # --------------------------------------------------------
    # Empty layout
    # --------------------------------------------------------

    if not rooms and not any(
        layout.get(name)
        for name in ("balcony", "garden", "terrace")
    ):

        return "<svg></svg>"

    # --------------------------------------------------------
    # Scale
    # --------------------------------------------------------

    scale = 12

    margin = 100

    plot_width = plot["width"]
    plot_length = plot["length"]

    svg_width = (
        plot_width * scale
        + margin * 2
    )

    svg_height = (
        plot_length * scale
        + margin * 2
    )

    origin_x = margin
    origin_y = margin

    elements = ["""
    <defs>
        <filter id="room-shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="1.5" dy="1.5" stdDeviation="1.2" flood-color="#8f8578" flood-opacity="0.22"/>
        </filter>
        <pattern id="tile-pattern" width="18" height="18" patternUnits="userSpaceOnUse">
            <rect width="18" height="18" fill="#eeeae3"/>
            <path d="M0 0H18M0 0V18" stroke="#d5cec3" stroke-width="0.8"/>
        </pattern>
        <pattern id="bath-pattern" width="14" height="14" patternUnits="userSpaceOnUse">
            <rect width="14" height="14" fill="#e7f0f0"/>
            <path d="M0 0H14M0 0V14" stroke="#c5dada" stroke-width="0.8"/>
        </pattern>
        <pattern id="parking-pattern" width="20" height="20" patternUnits="userSpaceOnUse">
            <rect width="20" height="20" fill="#d8d4cc"/>
            <path d="M0 20L20 0" stroke="#c2bdb4" stroke-width="1"/>
        </pattern>
    </defs>
    """]

    # --------------------------------------------------------
    # Background
    # --------------------------------------------------------

    elements.append(
        f"""
        <rect
            x="0"
            y="0"
            width="{svg_width}"
            height="{svg_height}"
            fill="white"
        />
        """
    )

    # --------------------------------------------------------
    # Plot boundary
    # --------------------------------------------------------

    plot_x = origin_x
    plot_y = origin_y

    plot_w = plot_width * scale
    plot_h = plot_length * scale

    elements.append(
        f"""
        <rect
            x="{plot_x}"
            y="{plot_y}"
            width="{plot_w}"
            height="{plot_h}"
            fill="#fafafa"
            stroke="#111"
            stroke-width="4"
        />
        """
    )

    # --------------------------------------------------------
    # Setback boundary
    # --------------------------------------------------------

    usable_x = (
        origin_x
        + usable_plot["x"] * scale
    )

    usable_y = (
        origin_y
        + usable_plot["y"] * scale
    )

    usable_w = (
        usable_plot["width"]
        * scale
    )

    usable_h = (
        usable_plot["length"]
        * scale
    )

    elements.append(
        f"""
        <rect
            x="{usable_x}"
            y="{usable_y}"
            width="{usable_w}"
            height="{usable_h}"
            fill="none"
            stroke="#888"
            stroke-width="2"
            stroke-dasharray="8,5"
        />
        """
    )

    # --------------------------------------------------------
    # Open spaces
    # --------------------------------------------------------

    elements.append(
        open_space_svg(
            open_spaces=layout.get("open_spaces"),
            scale=scale,
            origin_x=origin_x,
            origin_y=origin_y,
            usable_plot=usable_plot,
        )
    )

    elements.append(
        feature_svg(
            layout=layout,
            scale=scale,
            origin_x=origin_x,
            origin_y=origin_y,
        )
    )

    # --------------------------------------------------------
    # Road
    # --------------------------------------------------------

    elements.append(
        road_svg(
            plot_x=plot_x / scale,
            plot_y=plot_y / scale,
            plot_width=plot_width,
            plot_length=plot_length,
            scale=scale,
            road_side=road_side
        )
    )

    # --------------------------------------------------------
    # Rooms
    # --------------------------------------------------------

    elements.append(
        parking_svg(
            usable_plot=usable_plot,
            scale=scale,
            origin_x=origin_x,
            origin_y=origin_y,
        )
    )

    for room in rooms:

        elements.append(
            room_svg(
                room=room,
                scale=scale,
                origin_x=origin_x,
                origin_y=origin_y
            )
        )

    # --------------------------------------------------------
    # Doors and windows
    # --------------------------------------------------------

    elements.append(
        openings_svg(
            openings=layout.get("openings"),
            rooms=rooms,
            scale=scale,
            origin_x=origin_x,
            origin_y=origin_y,
        )
    )

    # --------------------------------------------------------
    # North arrow
    # --------------------------------------------------------

    elements.append(
        north_arrow_svg(
            svg_width - 60,
            70
        )
    )

    # --------------------------------------------------------
    # Title
    # --------------------------------------------------------

    elements.append(
        f"""
        <text
            x="{svg_width / 2}"
            y="45"
            text-anchor="middle"
            font-family="Arial"
            font-size="24"
            font-weight="bold"
        >
            AI GENERATED FLOOR PLAN
        </text>
        """
    )

    # --------------------------------------------------------
    # SVG
    # --------------------------------------------------------

    svg = f"""
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="{svg_width}"
        height="{svg_height}"
        viewBox="0 0 {svg_width} {svg_height}"
    >
        {"".join(elements)}
    </svg>
    """

    return svg