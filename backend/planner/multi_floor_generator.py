"""
Multi-floor layout generator.

Takes the rooms allocated by floor_manager.py
and generates an actual geometric layout for
each floor using the existing road-aware layout engine.
"""

from copy import deepcopy

from backend.planner.floor_manager import (
    create_building_structure,
)

from backend.planner.road_aware_optimizer import (
    road_aware_layout,
)

from backend.planner.open_space_engine import (
    analyze_open_spaces,
)
from backend.planner.openings import generate_openings


def _parking_reservation(usable_plot, parking, road_side):
    if not parking.get("required"):
        return None

    x = float(usable_plot["x"])
    y = float(usable_plot["y"])
    width = float(usable_plot["width"])
    length = float(usable_plot["length"])
    space_width = float(parking["width"])
    space_length = float(parking["length"])
    spaces = int(parking["spaces"])

    if str(road_side).lower() in {"north", "south"}:
        total_width = min(width, space_width * spaces)
        total_length = min(length, space_length)
        reserved_x = x + (width - total_width) / 2
        reserved_y = y + length - total_length if str(road_side).lower() == "north" else y
    else:
        total_width = min(width, space_length)
        total_length = min(length, space_width * spaces)
        reserved_x = x + width - total_width if str(road_side).lower() == "east" else x
        reserved_y = y + (length - total_length) / 2

    return {
        "room_type": "parking",
        "x": round(reserved_x, 2),
        "y": round(reserved_y, 2),
        "width": round(total_width, 2),
        "length": round(total_length, 2),
        "spaces": spaces,
    }


def generate_floor_layouts(
    rooms,
    plot,
    usable_plot,
    building_type="Ground",
    road_side="North",
    include_terrace=True,
    strategy="balanced",
    vastu_mode="no_preference",
    family_context=None,
    architectural_style="Modern Minimalistic",
    climate="Auto",
    parking=None,
    balcony_required=False,
    garden_required=False,
    terrace_features=None,
):
    """
    Generate geometric layouts for every floor.
    """

    # -----------------------------------------------------
    # Create building structure
    # -----------------------------------------------------

    building = create_building_structure(
        rooms=rooms,
        building_type=building_type,
        include_terrace=include_terrace,
        family_context=family_context,
    )

    floor_layouts = []

    # -----------------------------------------------------
    # Generate layout for every floor
    # -----------------------------------------------------

    for floor in building["floors"]:

        floor_name = floor["floor"]
        floor_rooms = floor["rooms"]
        floor_usable_plot = deepcopy(usable_plot)
        reservation = None
        if str(floor_name).lower().startswith("ground"):
            reservation = _parking_reservation(
                usable_plot,
                parking or {},
                road_side,
            )
        if reservation:
            floor_usable_plot["reserved_regions"] = [reservation]

        # ---------------------------------------------
        # Skip empty floors
        # ---------------------------------------------

        if not floor_rooms:

            layout = {
                "rooms": [],
                "plot": plot,
                "usable_plot": floor_usable_plot,
                "used_room_area": 0,
                "remaining_area": floor_usable_plot["area"] - (
                    reservation["width"] * reservation["length"]
                    if reservation else 0
                ),
                "valid": True,
            }

            layout["open_spaces"] = analyze_open_spaces(
                layout=layout,
                usable_plot=floor_usable_plot,
                road_side=road_side,
                style=architectural_style,
                climate=climate,
            )
            layout["openings"] = {
                "valid": True, "doors": [], "windows": [], "entrance": None, "errors": []
            }

            floor_layouts.append({
                "floor": floor_name,
                "layout": layout,
                "room_count": 0,
            })

            continue

        # ---------------------------------------------
        # Generate actual geometry
        # ---------------------------------------------

        layout = road_aware_layout(
            rooms=deepcopy(floor_rooms),
            usable_plot=floor_usable_plot,
            road_side=road_side,
            strategy=strategy,
            vastu_mode=vastu_mode,
        )

        layout["open_spaces"] = analyze_open_spaces(
            layout=layout,
            usable_plot=floor_usable_plot,
            road_side=road_side,
            style=architectural_style,
            climate=climate,
        )
        layout["plot"] = plot
        layout["usable_plot"] = floor_usable_plot
        layout["architectural_style"] = architectural_style
        layout["climate"] = climate
        layout["openings"] = generate_openings(
            rooms=layout.get("rooms", []),
            usable_plot=floor_usable_plot,
            road_side=road_side,
            climate=climate,
        )
        if not str(floor_name).lower().startswith("ground"):
            staircase = next(
                (room for room in layout.get("rooms", []) if room.get("room_type") == "staircase"),
                None,
            )
            if staircase:
                graph = layout["openings"]["circulation"]["graph"]
                reachable = {"staircase"}
                pending = ["staircase"]
                while pending:
                    current = pending.pop()
                    for connected in graph.get(current, []):
                        if connected not in reachable:
                            reachable.add(connected)
                            pending.append(connected)
                layout["openings"]["circulation"].update({
                    "entry_room": "staircase",
                    "reachable_rooms": sorted(reachable),
                    "connected": len(reachable) == len(graph),
                })
        free_regions = layout["open_spaces"].get("regions", [])
        if balcony_required and not str(floor_name).lower().startswith("ground"):
            bedroom = next((room for room in layout["rooms"] if room["room_type"] in {"master_bedroom", "bedroom"}), None)
            region = next((item for item in free_regions if item["width"] >= 6 and item["length"] >= 4), None)
            layout["balcony"] = {
                "exists": bool(region and bedroom),
                "x": region["x"] if region and bedroom else None,
                "y": region["y"] if region and bedroom else None,
                "width": min(region["width"], 8) if region and bedroom else 0,
                "length": min(region["length"], 5) if region and bedroom else 0,
                "attached_to": bedroom["room_type"] if region and bedroom else None,
            }
        else:
            layout["balcony"] = {"exists": False}
        if garden_required and str(floor_name).lower().startswith("ground"):
            region = next((item for item in free_regions if item["width"] >= 8 and item["length"] >= 8), None)
            layout["garden"] = {
                "exists": bool(region),
                "x": region["x"] if region else None,
                "y": region["y"] if region else None,
                "width": region["width"] if region else 0,
                "length": region["length"] if region else 0,
            }
        else:
            layout["garden"] = {"exists": False}
        living_room = next(
            (
                room for room in layout.get("rooms", [])
                if room.get("room_type") == "living_room"
            ),
            None,
        )
        layout["front_public"] = {
            "strategy": strategy,
            "living_room_distance": (
                round(
                    min(
                        living_room["x"] - floor_usable_plot["x"],
                        floor_usable_plot["x"] + floor_usable_plot["width"] - living_room["x2"],
                        living_room["y"] - floor_usable_plot["y"],
                        floor_usable_plot["y"] + floor_usable_plot["length"] - living_room["y2"],
                    ),
                    2,
                )
                if living_room else None
            ),
            "entrance_room": layout["openings"].get("entrance", {}).get("room")
            if layout["openings"].get("entrance") else None,
        }

        floor_layouts.append({
            "floor": floor_name,
            "layout": layout,
            "room_count": len(
                layout.get("rooms", [])
            ),
        })

    # -----------------------------------------------------
    # Return complete building
    # -----------------------------------------------------

    terrace_features = terrace_features or {}
    terrace_width = float(usable_plot["width"])
    terrace_length = float(usable_plot["length"])
    terrace = {
        "exists": bool(include_terrace),
        "x": float(usable_plot["x"]),
        "y": float(usable_plot["y"]),
        "width": terrace_width,
        "length": terrace_length,
        "features": terrace_features,
    }
    if include_terrace and terrace_features.get("solar_panels"):
        terrace["solar_panels"] = {
            "x": terrace["x"], "y": terrace["y"],
            "width": min(terrace_width * 0.35, 12),
            "length": min(terrace_length * 0.20, 8),
            "quantity": int(terrace_features.get("solar_quantity", 1)),
            "orientation": terrace_features.get("solar_orientation", "south"),
        }
    else:
        terrace["solar_panels"] = None
    if include_terrace and terrace_features.get("terrace_garden"):
        garden_width = min(terrace_width * 0.30, 12)
        garden_length = min(terrace_length * 0.25, 10)
        terrace["garden"] = {
            "x": terrace["x"] + terrace_width - garden_width,
            "y": terrace["y"] + terrace_length - garden_length,
            "width": garden_width, "length": garden_length,
        }
    else:
        terrace["garden"] = None

    for floor in floor_layouts:
        floor["layout"]["terrace"] = terrace

    return {
        "building_type": building_type,

        "floors": floor_layouts,

        "parking": parking or {"required": False, "spaces": 0},
        "terrace": terrace,
    }