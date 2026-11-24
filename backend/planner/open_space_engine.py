from typing import Dict, List, Tuple
from math import hypot

from backend.planner.style_knowledge import score_layout_style, get_style_profile
from backend.planner.climate_knowledge import score_climate_layout, get_climate_profile


OPEN_SPACE_TYPES = (
    "front_open_space",
    "rear_open_space",
    "side_open_space",
    "courtyard",
    "circulation",
    "future_expansion",
)


def _coordinates(room: Dict) -> Tuple[float, float, float, float]:
    x = float(room["x"])
    y = float(room["y"])
    width = float(room["width"])
    length = float(room["length"])
    return x, y, x + width, y + length


def _edges(usable_plot: Dict, rooms: List[Dict]):
    plot_x = float(usable_plot["x"])
    plot_y = float(usable_plot["y"])
    plot_x2 = plot_x + float(usable_plot["width"])
    plot_y2 = plot_y + float(usable_plot["length"])

    x_edges = {plot_x, plot_x2}
    y_edges = {plot_y, plot_y2}

    for room in rooms:
        x, y, x2, y2 = _coordinates(room)
        x_edges.update((max(plot_x, min(plot_x2, x)), max(plot_x, min(plot_x2, x2))))
        y_edges.update((max(plot_y, min(plot_y2, y)), max(plot_y, min(plot_y2, y2))))

    return (
        sorted(x_edges),
        sorted(y_edges),
        plot_x,
        plot_y,
        plot_x2,
        plot_y2,
    )


def _cell_is_occupied(
    center_x: float,
    center_y: float,
    rooms: List[Dict]
) -> bool:
    for room in rooms:
        x, y, x2, y2 = _coordinates(room)
        if x <= center_x < x2 and y <= center_y < y2:
            return True
    return False


def _merge_free_cells(
    free_cells: List[Tuple[float, float, float, float]]
) -> List[Dict]:
    rows = {}
    for x, y, x2, y2 in free_cells:
        rows.setdefault((y, y2), []).append((x, x2))

    horizontal = []
    for (y, y2), spans in rows.items():
        spans.sort()
        start_x, end_x = spans[0]
        for next_x, next_x2 in spans[1:]:
            if abs(next_x - end_x) < 0.001:
                end_x = next_x2
            else:
                horizontal.append((start_x, y, end_x, y2))
                start_x, end_x = next_x, next_x2
        horizontal.append((start_x, y, end_x, y2))

    merged = []
    for rectangle in sorted(horizontal, key=lambda value: (value[0], value[2], value[1])):
        x, y, x2, y2 = rectangle
        if merged:
            previous = merged[-1]
            if (
                abs(previous[0] - x) < 0.001
                and abs(previous[2] - x2) < 0.001
                and abs(previous[3] - y) < 0.001
            ):
                merged[-1] = (previous[0], previous[1], previous[2], y2)
                continue
        merged.append(rectangle)

    return [
        {
            "x": round(x, 2),
            "y": round(y, 2),
            "width": round(x2 - x, 2),
            "length": round(y2 - y, 2),
            "area": round((x2 - x) * (y2 - y), 2),
        }
        for x, y, x2, y2 in merged
    ]


def _merge_adjacent_regions(regions: List[Dict]) -> List[Dict]:
    """Consolidate adjacent regions that form one logical open zone."""
    merged = [dict(region) for region in regions]
    changed = True
    while changed:
        changed = False
        for index, first in enumerate(merged):
            for second_index in range(index + 1, len(merged)):
                second = merged[second_index]
                if first.get("type") != second.get("type"):
                    continue
                first_x2 = first["x"] + first["width"]
                first_y2 = first["y"] + first["length"]
                second_x2 = second["x"] + second["width"]
                second_y2 = second["y"] + second["length"]
                same_vertical_edge = (
                    abs(first_x2 - second["x"]) < 0.001
                    or abs(second_x2 - first["x"]) < 0.001
                ) and abs(first["y"] - second["y"]) < 0.001 and abs(first_y2 - second_y2) < 0.001
                same_horizontal_edge = (
                    abs(first_y2 - second["y"]) < 0.001
                    or abs(second_y2 - first["y"]) < 0.001
                ) and abs(first["x"] - second["x"]) < 0.001 and abs(first_x2 - second_x2) < 0.001
                if not (same_vertical_edge or same_horizontal_edge):
                    continue
                x = min(first["x"], second["x"])
                y = min(first["y"], second["y"])
                x2 = max(first["x2"], second["x2"])
                y2 = max(first["y2"], second["y2"])
                first.update({
                    "x": round(x, 2), "y": round(y, 2),
                    "width": round(x2 - x, 2), "length": round(y2 - y, 2),
                    "area": round((x2 - x) * (y2 - y), 2),
                })
                merged.pop(second_index)
                changed = True
                break
            if changed:
                break
    return merged


def _classify_region(
    region: Dict,
    usable_plot: Dict,
    road_side: str
) -> str:
    plot_x = float(usable_plot["x"])
    plot_y = float(usable_plot["y"])
    plot_x2 = plot_x + float(usable_plot["width"])
    plot_y2 = plot_y + float(usable_plot["length"])

    x = region["x"]
    y = region["y"]
    x2 = x + region["width"]
    y2 = y + region["length"]
    tolerance = 0.001

    touches_left = abs(x - plot_x) < tolerance
    touches_right = abs(x2 - plot_x2) < tolerance
    # Screen convention: y grows downward; "top" is the small-y (north) edge.
    touches_top = abs(y - plot_y) < tolerance
    touches_bottom = abs(y2 - plot_y2) < tolerance
    road = road_side.lower()

    if road == "north":
        touches_front = touches_top
        touches_rear = touches_bottom
    elif road == "south":
        touches_front = touches_bottom
        touches_rear = touches_top
    elif road == "east":
        touches_front = touches_right
        touches_rear = touches_left
    else:
        touches_front = touches_left
        touches_rear = touches_right

    if all((touches_left, touches_right, touches_bottom, touches_top)):
        return "future_expansion"

    if touches_front and not touches_rear:
        return "front_open_space"

    if touches_rear and not touches_front:
        return "rear_open_space"

    if (touches_left or touches_right or touches_bottom or touches_top) and not (
        touches_front or touches_rear
    ):
        return "side_open_space"

    plot_area = float(usable_plot["width"]) * float(usable_plot["length"])
    minimum_dimension = min(region["width"], region["length"])
    center_x = x + region["width"] / 2
    center_y = y + region["length"] / 2
    plot_center_x = plot_x + float(usable_plot["width"]) / 2
    plot_center_y = plot_y + float(usable_plot["length"]) / 2
    plot_diagonal = hypot(
        float(usable_plot["width"]),
        float(usable_plot["length"])
    )
    center_distance = hypot(
        center_x - plot_center_x,
        center_y - plot_center_y
    )

    if (
        region["area"] >= plot_area * 0.12
        and minimum_dimension >= 8
        and center_distance <= plot_diagonal * 0.3
    ):
        return "courtyard"

    if region["area"] >= plot_area * 0.15 and minimum_dimension >= 8:
        return "future_expansion"

    return "circulation"


def identify_open_spaces(
    usable_plot: Dict,
    rooms: List[Dict],
    road_side: str = "North"
) -> Dict:
    """Identify free rectangular regions inside the usable plot."""
    errors = []
    required_fields = ("x", "y", "width", "length")

    for room in rooms:
        missing = [field for field in required_fields if field not in room]
        if missing:
            errors.append(
                f"{room.get('room_type', 'room')} is missing: {', '.join(missing)}."
            )

    if errors:
        return {
            "valid": False,
            "usable_plot": usable_plot,
            "total_usable_area": 0,
            "occupied_room_area": 0,
            "remaining_unused_area": 0,
            "regions": [],
            "regions_by_type": {space_type: [] for space_type in OPEN_SPACE_TYPES},
            "errors": errors,
        }

    occupied_regions = rooms + list(usable_plot.get("reserved_regions", []))
    x_edges, y_edges, plot_x, plot_y, plot_x2, plot_y2 = _edges(
        usable_plot,
        occupied_regions
    )
    free_cells = []
    occupied_area = 0

    for y, y2 in zip(y_edges, y_edges[1:]):
        for x, x2 in zip(x_edges, x_edges[1:]):
            cell_area = (x2 - x) * (y2 - y)
            if _cell_is_occupied((x + x2) / 2, (y + y2) / 2, occupied_regions):
                occupied_area += cell_area
            else:
                free_cells.append((x, y, x2, y2))

    total_usable_area = (plot_x2 - plot_x) * (plot_y2 - plot_y)
    regions = _merge_free_cells(free_cells)

    for index, region in enumerate(regions, start=1):
        region["type"] = _classify_region(
            region,
            usable_plot,
            road_side
        )
        region["boundary"] = {
            "x": region["x"],
            "y": region["y"],
            "x2": round(region["x"] + region["width"], 2),
            "y2": round(region["y"] + region["length"], 2),
        }

    regions = _merge_adjacent_regions(regions)
    for index, region in enumerate(regions, start=1):
        region["region_id"] = f"open_space_{index}"
        region["boundary"] = {
            "x": region["x"], "y": region["y"],
            "x2": round(region["x"] + region["width"], 2),
            "y2": round(region["y"] + region["length"], 2),
        }

    regions_by_type = {space_type: [] for space_type in OPEN_SPACE_TYPES}
    for region in regions:
        regions_by_type[region["type"]].append(region)

    occupied_room_area = round(occupied_area, 2)
    remaining_unused_area = round(total_usable_area - occupied_area, 2)

    return {
        "valid": True,
        "usable_plot": usable_plot,
        "road_side": road_side,
        "total_usable_area": round(total_usable_area, 2),
        "occupied_room_area": occupied_room_area,
        "remaining_unused_area": remaining_unused_area,
        "open_space_ratio": round(remaining_unused_area / total_usable_area, 4),
        "regions": regions,
        "regions_by_type": regions_by_type,
        "setbacks_excluded": True,
        "errors": [],
    }


def analyze_open_spaces(
    layout: Dict,
    usable_plot: Dict = None,
    road_side: str = None,
    style: str = "Modern Minimalistic",
    climate: str = "Auto",
) -> Dict:
    """Analyze a layout dictionary using its rooms and usable plot."""
    if usable_plot is None:
        usable_plot = layout.get("usable_plot", {})

    selected_road_side = road_side or layout.get("road_side", "North")
    result = identify_open_spaces(
        usable_plot=usable_plot,
        rooms=layout.get("rooms", []),
        road_side=selected_road_side,
    )
    styled_layout = dict(layout)
    styled_layout["open_spaces"] = result
    styled_layout["usable_plot"] = usable_plot
    result["style"] = get_style_profile(style)["name"]
    result["style_preferences"] = {
        "preferred_openness": get_style_profile(style)["preferred_openness"],
        "courtyard": get_style_profile(style)["courtyard_preference"],
        "veranda": get_style_profile(style)["veranda_preference"],
        "indoor_outdoor": get_style_profile(style)["indoor_outdoor_relationship"],
    }
    result["style_score"] = score_layout_style(styled_layout, style)
    result["climate"] = get_climate_profile(climate)["climate_name"]
    result["climate_score"] = score_climate_layout(styled_layout, climate)
    return result


calculate_open_spaces = analyze_open_spaces
