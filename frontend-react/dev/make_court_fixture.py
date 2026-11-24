"""Builds dev/fixtures/wada_court.json: a hand-made single-storey plan whose centre is a courtyard (chowk) ringed by four verandah passages.

The planner never produces this (it does not plan internal courts); an uploaded plan that contains a court would, which is what the Wada
courtyard rendering is tested against.  Run:  python3 dev/make_court_fixture.py
"""
import json
from pathlib import Path

PLOT_W, PLOT_L = 44.0, 60.0
rooms_def = [
    # id, type, x, y, x2, y2
    ("master_bedroom", "master_bedroom", 3, 8, 17, 20), ("bath_master", "bathroom", 17, 8, 24, 20), ("bedroom_2", "bedroom", 24, 8, 41, 20),
    ("kitchen", "kitchen", 3, 20, 13, 30), ("dining", "dining", 3, 30, 13, 40),
    ("bedroom_3", "bedroom", 31, 20, 41, 30), ("study", "study", 31, 30, 41, 40),
    ("living_room", "living_room", 3, 40, 23, 52), ("puja_room", "puja_room", 23, 40, 29, 52), ("guest_bedroom", "guest_bedroom", 29, 40, 41, 52),
    ("passage_n", "passage", 17, 20, 31, 24), ("passage_e", "passage", 27, 24, 31, 40), ("passage_s", "passage", 13, 36, 27, 40), ("passage_w", "passage", 13, 20, 17, 36),
    ("courtyard", "courtyard", 17, 24, 27, 36),
]
NAMES = {"courtyard": "Courtyard (Chowk)", "passage": "Verandah", "master_bedroom": "Master Bedroom", "bath_master": "Master Bath", "bedroom_2": "Bedroom 2", "bedroom_3": "Bedroom 3",
         "guest_bedroom": "Guest Bedroom", "puja_room": "Puja Room", "living_room": "Living Room"}
rooms = []
for rid, t, x, y, x2, y2 in rooms_def:
    rooms.append({"id": rid, "name": NAMES.get(rid, NAMES.get(t, rid.replace("_", " ").title())), "room_type": t, "width": float(x2 - x), "length": float(y2 - y),
                  "area": float((x2 - x) * (y2 - y)), "x": float(x), "y": float(y), "x2": float(x2), "y2": float(y2), "floor_index": 0, "attached_to": None})
by = {r["id"]: r for r in rooms}


def wall_of(room, x1, y1, x2, y2):
    if abs(y1 - y2) < 1e-6:
        return ("top" if abs(y1 - room["y"]) < 1e-6 else "bottom", min(x1, x2) - room["x"])
    return ("left" if abs(x1 - room["x"]) < 1e-6 else "right", min(y1, y2) - room["y"])


def door(a, b, x1, y1, x2, y2, kind="internal"):
    ra = by[a]
    wall, pos = wall_of(ra, x1, y1, x2, y2)
    return {"room": a, "room_type": ra["room_type"], "wall": wall, "position": pos, "width": abs(x2 - x1) + abs(y2 - y1), "door_type": kind, "connects_to": b,
            "x1": float(x1), "y1": float(y1), "x2": float(x2), "y2": float(y2)}


doors = [
    door("living_room", None, 10, 52, 14, 52, "main"),
    door("living_room", "passage_s", 17, 40, 20, 40, "arch"),
    door("passage_s", "passage_e", 27, 37, 27, 39.5, "arch"), door("passage_e", "passage_n", 28, 24, 30.5, 24, "arch"),
    door("passage_n", "passage_w", 17, 20.5, 17, 23.5, "arch"), door("passage_w", "passage_s", 13.5, 36, 16.5, 36, "arch"),
    door("kitchen", "passage_w", 13, 22, 13, 26, "internal"), door("dining", "passage_w", 13, 31, 13, 34, "internal"), door("kitchen", "dining", 6, 30, 9, 30, "internal"),
    door("bedroom_3", "passage_e", 31, 25, 31, 28, "internal"), door("study", "passage_e", 31, 32, 31, 35, "internal"),
    door("master_bedroom", "passage_w", 14, 20, 16, 20, "internal"), door("bath_master", "master_bedroom", 17, 12, 17, 15, "internal"),
    door("bedroom_2", "passage_n", 25.5, 20, 28.5, 20, "internal"),
    door("puja_room", "living_room", 23, 44, 23, 47, "internal"), door("guest_bedroom", "living_room", 29, 44, 29, 47, "internal"),
]
for d in doors:
    if d["connects_to"] is None:
        d["connects_to"] = None


def window(room, wall, pos, width=4.0):
    return {"room": room, "room_type": by[room]["room_type"], "wall": wall, "position": pos, "width": width}


windows = [
    window("master_bedroom", "top", 2.0), window("master_bedroom", "top", 8.0), window("master_bedroom", "left", 4.0), window("bath_master", "top", 1.5, 3.0),
    window("bedroom_2", "top", 2.0), window("bedroom_2", "top", 10.0), window("bedroom_2", "right", 4.0),
    window("kitchen", "left", 3.0), window("dining", "left", 3.0), window("bedroom_3", "right", 3.0), window("study", "right", 3.0),
    window("living_room", "bottom", 2.0), window("living_room", "bottom", 14.0), window("living_room", "left", 4.0),
    window("guest_bedroom", "bottom", 4.0), window("guest_bedroom", "right", 4.0),
]
plot = {"width": PLOT_W, "length": PLOT_L, "area": PLOT_W * PLOT_L, "x": 0.0, "y": 0.0}
regions = [
    {"type": "front_open_space", "x": 0.0, "y": 52.0, "width": PLOT_W, "length": 8.0, "area": PLOT_W * 8},
    {"type": "rear_open_space", "x": 0.0, "y": 0.0, "width": PLOT_W, "length": 8.0, "area": PLOT_W * 8},
    {"type": "side_open_space", "x": 0.0, "y": 8.0, "width": 3.0, "length": 44.0, "area": 132.0},
    {"type": "side_open_space", "x": 41.0, "y": 8.0, "width": 3.0, "length": 44.0, "area": 132.0},
]
used = sum(r["area"] for r in rooms if r["room_type"] != "courtyard")
layout = {"rooms": rooms, "plot": plot, "usable_plot": {**plot}, "used_room_area": used, "remaining_area": PLOT_W * PLOT_L - used, "valid": True, "errors": [], "road_side": "South",
          "openings": {"valid": True, "errors": [], "doors": doors, "windows": windows, "entrance": {}, "circulation": {"connected": True}},
          "open_spaces": {"valid": True, "regions": regions, "errors": [], "total_usable_area": plot["area"], "occupied_room_area": used, "remaining_unused_area": plot["area"] - used},
          "front_public": {"strategy": "courtyard", "entrance_room": "living_room"}, "ducts": [], "balcony": {"exists": False}, "garden": {"exists": False}}
plan = {"plan_number": 1, "strategy": "courtyard", "topology": "courtyard", "building_type": "Ground", "vastu_mode": "no_preference", "architectural_style": "Maharashtrian Wada",
        "road_side": "South", "parking": {"required": False}, "staircase_required": False, "staircase": None,
        "floors": [{"floor": "Ground Floor", "layout": layout, "room_count": len(rooms)}], "terrace": {"exists": False}, "validation": [], "explanation": [], "engine": "fixture"}
out = Path(__file__).parent / "fixtures" / "wada_court.json"
out.write_text(json.dumps(plan, indent=1))
print("wrote", out, len(rooms), "rooms")
