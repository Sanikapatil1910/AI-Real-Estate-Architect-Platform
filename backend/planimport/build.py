"""Deterministic part of the upload workflow: reading -> scale -> editable canonical draft -> validation -> plan for the 3D viewer.

No Gemini call happens here, and nothing is invented silently:

* rooms come only from the reading (or from the user's own edits),
* the scale comes from a dimension the user typed, or from printed room dimensions that the user explicitly approves as approximate,
* doors and windows come only from the reading unless the user asks for "assumed" openings, which are then marked ``source: "assumed"``,
* every adjustment (edge snapping, clamped widths, dropped openings) is listed in ``draft["adjustments"]``.

The *draft* is the canonical plan model of this workflow.  Layer A (structure: rooms, walls, openings, scale) lives in the draft and can be edited only
while reviewing it.  Layer B (design: style, palette, materials, furniture) is applied afterwards by the 3D viewer and never moves anything.
"""
from __future__ import annotations

import math
import statistics
from typing import Any, Dict, List, Optional, Tuple

from backend.planner.architect.facade import apply_chajjas, apply_envelope
from backend.planner.architect.rules import DISPLAY, DOOR_WIDTH, WINDOW_WIDTH, WETROOM, BEDROOM_TYPES, door_allowed, door_label
from backend.planner.style_knowledge import canonical_style

SNAP_FT = 0.75              # edges closer than this are the same wall
ATTACH_FT = 1.6             # a door / window this close to a room edge belongs to it
GRID = 0.25
SCALE_AGREE = 0.12          # printed dimensions must agree within 12 % to propose a scale
MIN_ROOM_FT, MAX_ROOM_FT, MAX_SPAN_FT = 2.5, 120.0, 250.0
OVERLAP_ERR_SQFT = 1.5
ROAD_SIDES = ("North", "South", "East", "West")
TYPE_FOR_STORED = {"store": "utility", "other": "utility"}      # types the 3D model has no furniture for are built as plain rooms of the nearest kind
NAME_FOR = {"store": "Store", "other": "Room", "courtyard": "Courtyard", "toilet": "Toilet (WC)"}


class DraftError(Exception):
    def __init__(self, code: str, message: str, details: Optional[List[str]] = None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details or []


def _r(v: float, g: float = GRID) -> float:
    return round(round(v / g) * g, 2)


# ------------------------------------------------------------------------------------------------------------------ scale
def _box_px(box: Dict[str, float], W: int, H: int) -> Tuple[float, float]:
    return (box["x1"] - box["x0"]) / 1000.0 * W, (box["y1"] - box["y0"]) / 1000.0 * H


def suggest_scale(reading: Dict[str, Any]) -> Dict[str, Any]:
    """Scale candidates from the dimensions printed on the drawing.  The result is only ever a *proposal*: the user must approve it."""
    W, H = reading["image"]["width"], reading["image"]["height"]
    cands: List[Dict[str, Any]] = []
    for r in reading["rooms"]:
        if r.get("shape") != "rectangular":
            continue
        bw, bh = _box_px(r["box"], W, H)
        for axis, feet, px in (("width", r.get("width_ft"), bw), ("length", r.get("length_ft"), bh)):
            if feet and px > 8:
                cands.append({"room_id": r["id"], "label": r.get("label") or r["room_type"], "axis": axis, "feet": feet, "ft_per_px": feet / px})
    out: Dict[str, Any] = {"candidates": cands, "proposal": None, "needs_reference": True}
    if len(cands) >= 2:
        med = statistics.median(c["ft_per_px"] for c in cands)
        spread = max(abs(c["ft_per_px"] / med - 1) for c in cands)
        if spread <= SCALE_AGREE:
            out["proposal"] = {"ft_per_px": med, "n": len(cands), "spread_pct": round(spread * 100, 1),
                               "basis": f"{len(cands)} printed room dimensions agree within {spread * 100:.0f} %"}
            out["needs_reference"] = False
        else:
            out["disagree_pct"] = round(spread * 100, 1)
    return out


def resolve_scale(reading: Dict[str, Any], spec: Dict[str, Any]) -> Dict[str, Any]:
    """spec: {"mode":"reference","room_id","axis":"width|length","feet"} | {"mode":"overall","axis":"width|length","feet"} | {"mode":"approximate"}"""
    W, H = reading["image"]["width"], reading["image"]["height"]
    mode = spec.get("mode")
    rooms = reading["rooms"]
    if mode == "approximate":
        sug = suggest_scale(reading)
        if not sug["proposal"]:
            raise DraftError("scale_unavailable", "The drawing's printed dimensions are missing or do not agree, so no scale can be proposed. Enter one real dimension instead.")
        p = sug["proposal"]
        return {"ft_per_px": p["ft_per_px"], "source": "approved_approximate", "approximate": True,
                "description": f"Approximate scale you approved: {p['basis']}."}
    try:
        feet = float(spec.get("feet"))
    except (TypeError, ValueError):
        raise DraftError("bad_scale", "Enter the real length in feet as a number.")
    if not (2.0 <= feet <= 250.0):
        raise DraftError("bad_scale", "The reference length must be between 2 and 250 ft.")
    axis = spec.get("axis")
    if axis not in ("width", "length"):
        raise DraftError("bad_scale", "Say whether the reference is a width (left-right) or a length (top-bottom).")
    if mode == "reference":
        room = next((r for r in rooms if r["id"] == spec.get("room_id")), None)
        if not room:
            raise DraftError("bad_scale", "Pick the room you measured.")
        bw, bh = _box_px(room["box"], W, H)
        px = bw if axis == "width" else bh
        what = f"{room.get('label') or room['room_type']} {axis}"
    elif mode == "overall":
        if not rooms:
            raise DraftError("bad_scale", "There are no rooms to measure against yet.")
        x0, x1 = min(r["box"]["x0"] for r in rooms), max(r["box"]["x1"] for r in rooms)
        y0, y1 = min(r["box"]["y0"] for r in rooms), max(r["box"]["y1"] for r in rooms)
        px = (x1 - x0) / 1000.0 * W if axis == "width" else (y1 - y0) / 1000.0 * H
        what = f"overall building {axis}"
    else:
        raise DraftError("bad_scale", "Choose how the scale is set.")
    if px < 8:
        raise DraftError("bad_scale", "That reference is too small on the image to set a scale.")
    return {"ft_per_px": feet / px, "source": "user_reference", "approximate": False,
            "description": f"Scale set from your measurement: {what} = {feet:g} ft."}


# ------------------------------------------------------------------------------------------------------------------ geometry
def _cluster(values: List[float], tol: float) -> Dict[float, float]:
    out: Dict[float, float] = {}
    group: List[float] = []
    for v in sorted(set(values)):
        if group and v - group[0] > tol:
            m = _r(sum(group) / len(group))
            for g in group:
                out[g] = m
            group = []
        group.append(v)
    if group:
        m = _r(sum(group) / len(group))
        for g in group:
            out[g] = m
    return out


def _edges(room: Dict[str, Any]) -> List[Tuple[str, float, float, float, float]]:
    x, y, x2, y2 = room["x"], room["y"], room["x"] + room["width"], room["y"] + room["length"]
    return [("top", x, y, x2, y), ("bottom", x, y2, x2, y2), ("left", x, y, x, y2), ("right", x2, y, x2, y2)]


def _dist_to_seg(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> Tuple[float, float]:
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy), t * math.sqrt(L2)


def _room_at(rooms: List[Dict[str, Any]], x: float, y: float, skip: Optional[str] = None) -> Optional[Dict[str, Any]]:
    for r in rooms:
        if r["id"] != skip and r["x"] - 1e-6 <= x <= r["x"] + r["width"] + 1e-6 and r["y"] - 1e-6 <= y <= r["y"] + r["length"] + 1e-6:
            return r
    return None


def wall_geometry(room: Dict[str, Any], wall: str, pos: float, width: float) -> Tuple[float, float, float, float]:
    x, y, x2, y2 = room["x"], room["y"], room["x"] + room["width"], room["y"] + room["length"]
    if wall == "top":
        return x + pos, y, x + pos + width, y
    if wall == "bottom":
        return x + pos, y2, x + pos + width, y2
    if wall == "left":
        return x, y + pos, x, y + pos + width
    return x2, y + pos, x2, y + pos + width


def wall_length(room: Dict[str, Any], wall: str) -> float:
    return room["width"] if wall in ("top", "bottom") else room["length"]


def neighbour_across(rooms: List[Dict[str, Any]], room: Dict[str, Any], wall: str, pos: float, width: float) -> Optional[Dict[str, Any]]:
    """The room on the other side of `wall` at the middle of the opening (None = the outside)."""
    x1, y1, x2, y2 = wall_geometry(room, wall, pos, width)
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    d = 0.4
    px, py = {"top": (mx, my - d), "bottom": (mx, my + d), "left": (mx - d, my), "right": (mx + d, my)}[wall]
    return _room_at(rooms, px, py, skip=room["id"])


# ------------------------------------------------------------------------------------------------------------------ reading -> draft
def _unique_name(base: str, taken: Dict[str, int]) -> str:
    taken[base] = taken.get(base, 0) + 1
    return base if taken[base] == 1 else f"{base} {taken[base]}"


def reading_to_draft(reading: Dict[str, Any], scale: Dict[str, Any]) -> Dict[str, Any]:
    W, H = reading["image"]["width"], reading["image"]["height"]
    k = scale["ft_per_px"]
    adjustments: List[str] = []
    uncertain: List[str] = []
    raw = []
    for r in reading["rooms"]:
        b = r["box"]
        raw.append((r, b["x0"] / 1000 * W * k, b["y0"] / 1000 * H * k, b["x1"] / 1000 * W * k, b["y1"] / 1000 * H * k))
    if not raw:
        return _finish({"rooms": [], "doors": [], "windows": []}, scale, reading, adjustments, uncertain)
    ox, oy = min(t[1] for t in raw), min(t[2] for t in raw)
    scale = {**scale, "origin_px": {"x": round(ox / k, 1), "y": round(oy / k, 1)}}     # where the building's top-left corner is on the image (for the overlay)
    xs = _cluster([v for t in raw for v in (t[1] - ox, t[3] - ox)], SNAP_FT)
    ys = _cluster([v for t in raw for v in (t[2] - oy, t[4] - oy)], SNAP_FT)
    rooms: List[Dict[str, Any]] = []
    names: Dict[str, int] = {}
    counts: Dict[str, int] = {}
    moved = 0
    for r, x0, y0, x1, y1 in raw:
        a, b, c, d = xs[x0 - ox], ys[y0 - oy], xs[x1 - ox], ys[y1 - oy]
        if c - a < 1.0 or d - b < 1.0:
            a, b, c, d = _r(x0 - ox), _r(y0 - oy), _r(x1 - ox), _r(y1 - oy)
        if max(abs(a - (x0 - ox)), abs(b - (y0 - oy)), abs(c - (x1 - ox)), abs(d - (y1 - oy))) > 0.06:
            moved += 1
        rt = r["room_type"]
        stored = TYPE_FOR_STORED.get(rt, rt)
        counts[stored] = counts.get(stored, 0) + 1
        base = r.get("label") or NAME_FOR.get(rt) or DISPLAY.get(rt, rt.replace("_", " ").title())
        room = {"id": f"{stored}_{counts[stored]}", "name": _unique_name(base, names), "room_type": stored, "x": a, "y": b,
                "width": round(c - a, 2), "length": round(d - b, 2), "source": r["provenance"], "confidence": r["confidence"],
                "note": None, "_src": r["id"]}
        if rt in TYPE_FOR_STORED:
            room["note"] = f"Read as '{rt}'; built as a plain {DISPLAY.get(stored, stored).lower()}."
        if r["shape"] != "rectangular":
            room["note"] = f"{r['shape'].replace('_', '-')} room approximated by its bounding box."
        if r["confidence"] == "low":
            uncertain.append(f"{room['name']}: low confidence - check its size and type.")
        if r["provenance"] == "inferred":
            uncertain.append(f"{room['name']}: its type or outline was inferred, not read from a label.")
        rooms.append(room)
    if moved:
        adjustments.append(f"{moved} room edge(s) were aligned (within {SNAP_FT} ft) so neighbouring rooms share one wall.")
    # doors / windows: attach to the nearest room edge, drop what cannot be attached
    doors: List[Dict[str, Any]] = []
    windows: List[Dict[str, Any]] = []
    main_taken = False
    for d in sorted(reading["doors"], key=lambda q: (not q.get("is_main_entrance"), q["confidence"] != "high")):
        x, y = d["at"]["x"] / 1000 * W * k - ox, d["at"]["y"] / 1000 * H * k - oy
        hit = _nearest_edge(rooms, x, y)
        if not hit:
            adjustments.append("A door that is not on any room wall was left out.")
            continue
        room, wall, along = hit
        wl = wall_length(room, wall)
        assumed_w = d.get("width_ft") is None
        other = None
        w0 = d.get("width_ft") or DOOR_WIDTH["internal"]
        w0 = min(max(w0, 1.5), max(1.5, wl - 0.6))
        pos = min(max(along - w0 / 2, 0.3), max(0.3, wl - w0 - 0.3))
        other = neighbour_across(rooms, room, wall, pos, w0)
        main = bool(d.get("is_main_entrance")) and other is None and not main_taken
        if d.get("is_main_entrance") and other is not None:
            adjustments.append("A door marked as the main entrance is between two rooms, so it was treated as an ordinary door.")
        dtype = "main" if main else door_label(room["room_type"], other["room_type"] if other else "living_room") if other else "internal"
        if other is None and not main:
            dtype = "internal"
        if main:
            main_taken = True
            if assumed_w:
                w0 = min(DOOR_WIDTH["main"], max(1.5, wl - 0.6))
                pos = min(max(along - w0 / 2, 0.3), max(0.3, wl - w0 - 0.3))
        elif assumed_w:
            w0 = min(DOOR_WIDTH.get(dtype, 3.0), max(1.5, wl - 0.6))
            pos = min(max(along - w0 / 2, 0.3), max(0.3, wl - w0 - 0.3))
        doors.append({"id": f"door_{len(doors) + 1}", "room": room["id"], "wall": wall, "position": _r(pos), "width": _r(w0), "door_type": dtype,
                      "connects_to": other["id"] if other else None, "source": d["provenance"], "confidence": d["confidence"], "width_assumed": assumed_w})
    for w in reading["windows"]:
        x, y = w["at"]["x"] / 1000 * W * k - ox, w["at"]["y"] / 1000 * H * k - oy
        hit = _nearest_edge(rooms, x, y)
        if not hit:
            adjustments.append("A window that is not on any room wall was left out.")
            continue
        room, wall, along = hit
        wl = wall_length(room, wall)
        assumed_w = w.get("width_ft") is None
        w0 = w.get("width_ft") or WINDOW_WIDTH.get(room["room_type"], 3.0) or 3.0
        w0 = min(max(w0, 1.0), max(1.0, wl - 0.8))
        pos = min(max(along - w0 / 2, 0.4), max(0.4, wl - w0 - 0.4))
        other = neighbour_across(rooms, room, wall, pos, w0)
        if other is not None and other["room_type"] not in ("courtyard", "balcony"):
            adjustments.append("A window on a wall between two rooms was left out (windows are placed on outside walls).")
            continue
        windows.append({"id": f"window_{len(windows) + 1}", "room": room["id"], "wall": wall, "position": _r(pos), "width": _r(w0),
                        "source": w["provenance"], "confidence": w["confidence"], "width_assumed": assumed_w})
    if any(d["width_assumed"] for d in doors) or any(w["width_assumed"] for w in windows):
        uncertain.append("Door / window widths that are not printed were set to standard widths.")
    return _finish({"rooms": rooms, "doors": doors, "windows": windows}, scale, reading, adjustments, uncertain)


def _nearest_edge(rooms: List[Dict[str, Any]], x: float, y: float) -> Optional[Tuple[Dict[str, Any], str, float]]:
    best: Optional[Tuple[float, Dict[str, Any], str, float]] = None
    for room in rooms:
        for wall, ax, ay, bx, by in _edges(room):
            dist, along = _dist_to_seg(x, y, ax, ay, bx, by)
            if best is None or dist < best[0] - 1e-9:
                best = (dist, room, wall, along)
    if best is None or best[0] > ATTACH_FT:
        return None
    return best[1], best[2], best[3]


def _finish(parts: Dict[str, Any], scale: Dict[str, Any], reading: Dict[str, Any], adjustments: List[str], uncertain: List[str]) -> Dict[str, Any]:
    for r in parts["rooms"]:
        r.pop("_src", None)
    unknown = [f"Not determinable from the drawing: {u}" for u in reading.get("unknown", [])]
    draft = {"version": 1, "scale": {k: v for k, v in scale.items()}, "floor_label": reading.get("floor_label") or "Ground Floor",
             "rooms": parts["rooms"], "doors": parts["doors"], "windows": parts["windows"],
             "adjustments": adjustments, "uncertainties": list(dict.fromkeys(uncertain + unknown + reading.get("notes", []))),
             "assumptions": []}
    if scale.get("approximate"):
        draft["assumptions"].append("The scale is approximate (from printed room dimensions you approved); real sizes may differ by several percent.")
    draft["assumptions"].append("North is assumed to be at the top of the drawing unless you choose the road side below.")
    draft["check"] = validate_draft(draft)
    return draft


# ------------------------------------------------------------------------------------------------------------------ validation
def _union_area(rooms: List[Dict[str, Any]]) -> float:
    xs = sorted({v for r in rooms for v in (r["x"], r["x"] + r["width"])})
    ys = sorted({v for r in rooms for v in (r["y"], r["y"] + r["length"])})
    area = 0.0
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if _room_at(rooms, cx, cy):
                area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j])
    return area


def validate_draft(draft: Dict[str, Any]) -> Dict[str, List[str]]:
    errors: List[str] = []
    warnings: List[str] = []
    rooms = draft.get("rooms") or []
    if not rooms:
        errors.append("There are no rooms yet. Add at least one room.")
        return {"errors": errors, "warnings": warnings}
    ids = [r["id"] for r in rooms]
    if len(set(ids)) != len(ids):
        errors.append("Two rooms share the same id.")
    for r in rooms:
        for k in ("x", "y", "width", "length"):
            if not isinstance(r.get(k), (int, float)) or isinstance(r.get(k), bool) or r[k] != r[k] or abs(r[k]) > 1000:
                errors.append(f"{r.get('name', r['id'])}: {k} is not a valid number.")
        if errors and errors[-1].startswith(f"{r.get('name', r['id'])}:"):
            continue
        if r["width"] < MIN_ROOM_FT or r["length"] < MIN_ROOM_FT:
            errors.append(f"{r['name']} is only {r['width']:g} x {r['length']:g} ft; rooms must be at least {MIN_ROOM_FT} ft on each side.")
        if r["width"] > MAX_ROOM_FT or r["length"] > MAX_ROOM_FT:
            errors.append(f"{r['name']} is {r['width']:g} x {r['length']:g} ft - that is larger than any room; the scale is probably wrong.")
    if errors:
        return {"errors": errors, "warnings": warnings}
    x0, x1 = min(r["x"] for r in rooms), max(r["x"] + r["width"] for r in rooms)
    y0, y1 = min(r["y"] for r in rooms), max(r["y"] + r["length"] for r in rooms)
    if x1 - x0 > MAX_SPAN_FT or y1 - y0 > MAX_SPAN_FT:
        errors.append(f"The building would be {x1 - x0:.0f} x {y1 - y0:.0f} ft; that is larger than a house - check the scale.")
    for i, a in enumerate(rooms):
        for b in rooms[i + 1:]:
            w = min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"])
            h = min(a["y"] + a["length"], b["y"] + b["length"]) - max(a["y"], b["y"])
            if w > 1e-6 and h > 1e-6 and w * h > OVERLAP_ERR_SQFT:
                errors.append(f"{a['name']} and {b['name']} overlap by {w * h:.1f} sq ft. Move or resize one of them.")
    by = {r["id"]: r for r in rooms}
    for kind in ("doors", "windows"):
        for o in draft.get(kind) or []:
            room = by.get(o.get("room"))
            if not room:
                errors.append(f"A {kind[:-1]} refers to a room that does not exist.")
                continue
            if o.get("wall") not in ("top", "bottom", "left", "right"):
                errors.append(f"A {kind[:-1]} in {room['name']} has no wall.")
                continue
            wl = wall_length(room, o["wall"])
            if not (isinstance(o.get("width"), (int, float)) and 1.0 <= o["width"] <= wl - 0.2):
                errors.append(f"A {kind[:-1]} in {room['name']} ({o['wall']} wall) does not fit on the wall ({wl:g} ft).")
            elif not (isinstance(o.get("position"), (int, float)) and -1e-6 <= o["position"] <= wl - o["width"] + 1e-6):
                errors.append(f"A {kind[:-1]} in {room['name']} ({o['wall']} wall) sticks out past the wall's end.")
    if errors:
        return {"errors": errors, "warnings": warnings}
    bbox = (x1 - x0) * (y1 - y0)
    uncovered = bbox - _union_area(rooms)
    if bbox > 0 and uncovered / bbox > 0.12:
        warnings.append(f"{uncovered / bbox * 100:.0f} % of the building's footprint ({uncovered:.0f} sq ft) is not covered by any room - open space, thick walls or rooms that were not detected. It is left empty in 3D.")
    doors = draft.get("doors") or []
    if not doors:
        warnings.append("No doors are defined, so the 3D model has solid walls. Add doors or tick 'fill in standard doors and windows' (they are marked as assumed).")
    elif not any(d.get("door_type") == "main" for d in doors):
        warnings.append("No main entrance is marked. Mark one door as the main entrance.")
    if doors:
        graph: Dict[str, set] = {r["id"]: set() for r in rooms}
        for d in doors:
            if d.get("connects_to") in graph:
                graph[d["room"]].add(d["connects_to"])
                graph[d["connects_to"]].add(d["room"])
        start = next((d["room"] for d in doors if d.get("door_type") == "main"), doors[0]["room"])
        seen, stack = {start}, [start]
        while stack:
            for n in graph[stack.pop()]:
                if n not in seen:
                    seen.add(n)
                    stack.append(n)
        cut = [by[i]["name"] for i in graph if i not in seen]
        if cut:
            warnings.append("Not reachable through the doors from the entrance: " + ", ".join(cut) + ".")
    return {"errors": errors, "warnings": warnings}


# ------------------------------------------------------------------------------------------------------------------ assumed openings (opt-in)
def add_assumed_openings(draft: Dict[str, Any], road_side: str) -> Dict[str, Any]:
    """Opt-in: standard doors and windows for a drawing that showed none.  Every one is marked ``source: "assumed"``.
    Doors follow the project's own adjacency rules (`door_allowed`); the entrance goes on the road-side wall of the living room."""
    d = {**draft, "doors": list(draft["doors"]), "windows": list(draft["windows"]), "adjustments": list(draft["adjustments"])}
    rooms = d["rooms"]
    if not rooms:
        return d
    have_doors = bool(d["doors"])
    added_d = added_w = 0
    if not have_doors:
        living = next((r for r in rooms if r["room_type"] == "living_room"), None) or max(rooms, key=lambda r: r["width"] * r["length"])
        reach = {living["id"]}
        pairs: List[Tuple[Dict[str, Any], str, Dict[str, Any], float, float]] = []

        def best_parent(other: Dict[str, Any], strict: bool):
            cands = []
            for cur in rooms:
                if cur["id"] not in reach:
                    continue
                if strict and not door_allowed(cur["room_type"], other["room_type"]):
                    continue
                if not strict and (cur["room_type"] in WETROOM or other["room_type"] in WETROOM and cur["room_type"] not in BEDROOM_TYPES):
                    continue
                share = _shared_wall(cur, other)
                if share and share[2] >= 3.4:
                    pri = 0 if (other["room_type"] in WETROOM and cur["room_type"] in BEDROOM_TYPES) else 1
                    cands.append((pri, -share[2], cur["id"], cur, share))
            return min(cands, key=lambda c: c[:3]) if cands else None

        for strict in (True, False):
            progress = True
            while progress:
                progress = False
                for other in sorted((r for r in rooms if r["id"] not in reach), key=lambda r: -r["width"] * r["length"]):
                    bp = best_parent(other, strict)
                    if bp:
                        cur, share = bp[3], bp[4]
                        reach.add(other["id"])
                        pairs.append((cur, share[0], other, share[1], share[2]))
                        progress = True
        for cur, wall, other, lo, length in pairs:
            dtype = door_label(cur["room_type"], other["room_type"])
            wd = min(DOOR_WIDTH.get(dtype, 3.0), length - 0.6)
            pos = _r(lo + (length - wd) / 2 - (cur["x"] if wall in ("top", "bottom") else cur["y"]))
            d["doors"].append({"id": f"door_{len(d['doors']) + 1}", "room": cur["id"], "wall": wall, "position": pos, "width": _r(wd), "door_type": dtype,
                               "connects_to": other["id"], "source": "assumed", "confidence": "low", "width_assumed": True})
            added_d += 1
        # entrance: road-side wall of the living room
        wall = {"North": "top", "South": "bottom", "West": "left", "East": "right"}.get(road_side, "bottom")
        ext = _exterior_wall(rooms, living, wall) or next((w for w in ("bottom", "top", "left", "right") if _exterior_wall(rooms, living, w)), None)
        if ext:
            wl = wall_length(living, ext)
            wd = min(DOOR_WIDTH["main"], wl - 0.6)
            d["doors"].append({"id": f"door_{len(d['doors']) + 1}", "room": living["id"], "wall": ext, "position": _r((wl - wd) / 2), "width": _r(wd),
                               "door_type": "main", "connects_to": None, "source": "assumed", "confidence": "low", "width_assumed": True})
            added_d += 1
    if not d["windows"]:
        for r in rooms:
            wd0 = WINDOW_WIDTH.get(r["room_type"], 0.0)
            if wd0 <= 0 or r["room_type"] in ("passage", "staircase", "courtyard", "parking"):
                continue
            for wall in ("top", "bottom", "left", "right"):
                if not _exterior_wall(rooms, r, wall):
                    continue
                wl = wall_length(r, wall)
                wd = min(wd0, wl - 1.6)
                if wd < 1.0:
                    continue
                pos = _r((wl - wd) / 2)
                if any(o["room"] == r["id"] and o["wall"] == wall and abs(o["position"] + o["width"] / 2 - (pos + wd / 2)) < (o["width"] + wd) / 2 + 0.2 for o in d["doors"]):
                    continue
                d["windows"].append({"id": f"window_{len(d['windows']) + 1}", "room": r["id"], "wall": wall, "position": pos, "width": _r(wd),
                                     "source": "assumed", "confidence": "low", "width_assumed": True})
                added_w += 1
                break                                       # one window per room on its first outside wall
    if added_d or added_w:
        d["adjustments"].append(f"Assumed (not in the drawing): {added_d} door(s) and {added_w} window(s) were added at standard sizes at your request; they are marked 'assumed'.")
    d["check"] = validate_draft(d)
    return d


def _shared_wall(a: Dict[str, Any], b: Dict[str, Any]) -> Optional[Tuple[str, float, float]]:
    """(wall of a, start along the shared line in absolute feet, length) when a and b touch along a wall."""
    eps = 0.3
    ax1, ay1, ax2, ay2 = a["x"], a["y"], a["x"] + a["width"], a["y"] + a["length"]
    bx1, by1, bx2, by2 = b["x"], b["y"], b["x"] + b["width"], b["y"] + b["length"]
    ox = min(ax2, bx2) - max(ax1, bx1)
    oy = min(ay2, by2) - max(ay1, by1)
    if abs(ay1 - by2) < eps and ox > 0:
        return "top", max(ax1, bx1), ox
    if abs(ay2 - by1) < eps and ox > 0:
        return "bottom", max(ax1, bx1), ox
    if abs(ax1 - bx2) < eps and oy > 0:
        return "left", max(ay1, by1), oy
    if abs(ax2 - bx1) < eps and oy > 0:
        return "right", max(ay1, by1), oy
    return None


def _exterior_wall(rooms: List[Dict[str, Any]], r: Dict[str, Any], wall: str) -> bool:
    wl = wall_length(r, wall)
    return neighbour_across(rooms, r, wall, max(0.0, wl / 2 - 0.5), 1.0) is None


# ------------------------------------------------------------------------------------------------------------------ draft -> plan
def draft_to_plan(draft: Dict[str, Any], options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Build the plan dict the 3D viewer, the 2D drawing and the .glb export already understand (same shape as the generator's plans)."""
    opt = options or {}
    chk = validate_draft(draft)
    if chk["errors"]:
        raise DraftError("invalid_draft", "The plan has problems that must be fixed before the 3D model can be built.", chk["errors"])
    road = opt.get("road_side") if opt.get("road_side") in ROAD_SIDES else "South"
    try:
        margin = min(max(float(opt.get("site_margin_ft", 0) or 0), 0.0), 60.0)
    except (TypeError, ValueError):
        margin = 0.0
    style = canonical_style(opt.get("architectural_style"))
    rooms_in = draft["rooms"]
    x0, y0 = min(r["x"] for r in rooms_in), min(r["y"] for r in rooms_in)
    sx, sy = margin - x0, margin - y0
    rooms: List[Dict[str, Any]] = []
    for r in rooms_in:
        rooms.append({"id": r["id"], "name": r["name"], "room_type": r["room_type"], "width": round(r["width"], 2), "length": round(r["length"], 2),
                      "area": round(r["width"] * r["length"], 2), "x": round(r["x"] + sx, 2), "y": round(r["y"] + sy, 2),
                      "x2": round(r["x"] + r["width"] + sx, 2), "y2": round(r["y"] + r["length"] + sy, 2), "floor_index": 0, "attached_to": None})
    by = {r["id"]: r for r in rooms}
    fx2, fy2 = max(r["x2"] for r in rooms), max(r["y2"] for r in rooms)
    pw, pl = round(fx2 + margin, 2), round(fy2 + margin, 2)
    doors, windows = [], []
    for o in draft.get("doors") or []:
        room = by[o["room"]]
        x1, y1, x2, y2 = (round(v, 2) for v in wall_geometry(room, o["wall"], o["position"], o["width"]))
        doors.append({"room": room["id"], "room_type": room["room_type"], "wall": o["wall"], "position": round(o["position"], 2), "width": round(o["width"], 2),
                      "door_type": o.get("door_type") or "internal", "connects_to": o.get("connects_to"), "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                      "source": o.get("source", "detected")})
    for o in draft.get("windows") or []:
        room = by[o["room"]]
        windows.append({"room": room["id"], "room_type": room["room_type"], "wall": o["wall"], "position": round(o["position"], 2), "width": round(o["width"], 2),
                        "source": o.get("source", "detected")})
    main = next((d for d in doors if d["door_type"] == "main"), None)
    graph: Dict[str, List[str]] = {r["id"]: [] for r in rooms}
    for d in doors:
        c = d.get("connects_to")
        if c in graph:
            graph[d["room"]].append(c)
            graph[c].append(d["room"])
    entry = main["room"] if main else (doors[0]["room"] if doors else rooms[0]["id"])
    reach, stack = {entry}, [entry]
    while stack:
        for n in graph[stack.pop()]:
            if n not in reach:
                reach.add(n)
                stack.append(n)
    openings = {"valid": True, "errors": [], "doors": doors, "windows": windows,
                "entrance": ({"room": main["room"], "wall": main["wall"], "position": main["position"], "width": main["width"], "valid": True} if main else None),
                "circulation": {"graph": graph, "entry_room": entry, "reachable_rooms": sorted(reach), "connected": len(reach) == len(graph), "valid": True, "errors": []}}
    used = round(sum(r["area"] for r in rooms), 2)
    plot = {"width": pw, "length": pl, "area": round(pw * pl, 2), "x": 0.0, "y": 0.0}
    usable = {"width": pw, "length": pl, "area": round(pw * pl, 2), "x": 0.0, "y": 0.0}
    layout = {
        "rooms": rooms, "plot": plot, "usable_plot": usable, "used_room_area": used, "remaining_area": round(max(0.0, usable["area"] - used), 2),
        "valid": True, "errors": [], "road_side": road, "openings": openings,
        "open_spaces": {"valid": True, "regions": [], "errors": [], "total_usable_area": usable["area"], "occupied_room_area": used,
                        "remaining_unused_area": round(max(0.0, usable["area"] - used), 2)},
        "front_public": {"strategy": "uploaded plan", "entrance_room": main["room"] if main else None},
        "ducts": [], "roof_areas": [], "balcony": {"exists": False}, "garden": {"exists": False},
    }
    bal = next((r for r in rooms if r["room_type"] == "balcony"), None)
    if bal:
        layout["balcony"] = {"exists": True, "x": bal["x"], "y": bal["y"], "width": bal["width"], "length": bal["length"], "attached_to": "bedroom"}
    floor_name = draft.get("floor_label") or "Ground Floor"
    n_det = sum(1 for r in rooms_in if r.get("source") == "detected")
    explain = [f"Built from an uploaded 2D plan ({len(rooms)} rooms, {len(doors)} doors, {len(windows)} windows) on a single floor.",
               draft["scale"].get("description", ""),
               f"{n_det} of {len(rooms)} rooms were read directly from the drawing; the rest were inferred or added by you.",
               "No room, wall, door or window was added that is not listed in the review step."]
    if any(o.get("source") == "assumed" for o in (draft.get("doors") or []) + (draft.get("windows") or [])):
        explain.append("Some doors / windows are standard assumed ones (you asked for them); they are marked 'assumed' in the review.")
    plan = {
        "plan_number": 1, "strategy": "Uploaded plan", "topology": "uploaded", "building_type": "Ground", "vastu_mode": "no_preference",
        "architectural_style": style, "road_side": road, "parking": None, "staircase_required": False, "staircase": None,
        "floors": [{"floor": floor_name, "layout": layout, "room_count": len(rooms)}],
        "terrace": {"exists": False, "x": 0.0, "y": 0.0, "width": 0.0, "length": 0.0, "features": {}, "solar_panels": None, "garden": None},
        "validation": [{"floor": floor_name, "validation": {"valid": True, "errors": [], "warnings": chk["warnings"], "overall_score": 0.0, "scores": {"functional": 0.0, "vastu": 0.0},
                                                          "quality_5factor": {"overall_score": 0.0, "factors": {}}}}],
        "explanation": [e for e in explain if e], "engine": "upload",
        "site": {"frontage": pw, "depth": pl, "road_side": road, "frontage_selected": False, "entered_plot": [pw, pl], "plot_width": pw, "plot_length": pl},
        "import_report": {"scale": draft["scale"], "adjustments": draft.get("adjustments", []), "uncertainties": draft.get("uncertainties", []),
                          "assumptions": draft.get("assumptions", []), "warnings": chk["warnings"]},
    }
    apply_chajjas(plan, {})
    apply_envelope(plan, {}, projections=False)   # roof overhang only: an uploaded plan's structure is the user's, so no balcony cantilevers are added
    return plan


# ------------------------------------------------------------------------------------------------------------------ untrusted input
_ROOM_TYPES = set(DISPLAY) | {"courtyard", "utility", "foyer", "toilet", "dressing", "store"}
_SRC = ("detected", "inferred", "manual", "assumed")
_CONF = ("high", "medium", "low")


def _s(v: Any, n: int, default: str = "") -> str:
    if not isinstance(v, str):
        return default
    t = "".join(ch for ch in v if ch.isprintable() and ch not in "<>").strip()
    return " ".join(t.split())[:n] or default


def _f(v: Any, name: str, lo: float = -1000, hi: float = 1000) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or not (lo <= v <= hi):
        raise DraftError("bad_value", f"'{name}' must be a number between {lo:g} and {hi:g}.")
    return float(v)


def clean_draft(obj: Any) -> Dict[str, Any]:
    """The client sends the (edited) draft back; rebuild it from typed fields only before anything uses it."""
    if not isinstance(obj, dict):
        raise DraftError("bad_draft", "The plan is missing.")
    rooms_in, doors_in, wins_in = obj.get("rooms"), obj.get("doors") or [], obj.get("windows") or []
    if not isinstance(rooms_in, list) or not isinstance(doors_in, list) or not isinstance(wins_in, list):
        raise DraftError("bad_draft", "The plan is malformed.")
    if len(rooms_in) > 60 or len(doors_in) > 120 or len(wins_in) > 160:
        raise DraftError("bad_draft", "The plan has too many rooms, doors or windows.")
    rooms, used = [], set()
    for i, r in enumerate(rooms_in):
        if not isinstance(r, dict):
            raise DraftError("bad_draft", "A room is malformed.")
        rid = _s(r.get("id"), 40) or f"room_{i + 1}"
        rid = "".join(ch if ch.isalnum() or ch in "_-" else "_" for ch in rid)
        if rid in used:
            rid = f"{rid}_{i + 1}"
        used.add(rid)
        rt = r.get("room_type") if r.get("room_type") in _ROOM_TYPES else None
        if rt is None:
            raise DraftError("bad_draft", f"Room {i + 1} has an unknown type.")
        rooms.append({"id": rid, "name": _s(r.get("name"), 40, DISPLAY.get(rt, rt)), "room_type": TYPE_FOR_STORED.get(rt, rt),
                      "x": _f(r.get("x"), "x"), "y": _f(r.get("y"), "y"), "width": _f(r.get("width"), "width"), "length": _f(r.get("length"), "length"),
                      "source": r.get("source") if r.get("source") in _SRC else "manual", "confidence": r.get("confidence") if r.get("confidence") in _CONF else "medium",
                      "note": _s(r.get("note"), 160) or None})
    def opening(o: Any, kind: str) -> Dict[str, Any]:
        if not isinstance(o, dict):
            raise DraftError("bad_draft", f"A {kind} is malformed.")
        base = {"id": _s(o.get("id"), 30, kind), "room": _s(o.get("room"), 40), "wall": o.get("wall") if o.get("wall") in ("top", "bottom", "left", "right") else "",
                "position": _f(o.get("position"), "position", -5, 1000), "width": _f(o.get("width"), "width", 0, 100),
                "source": o.get("source") if o.get("source") in _SRC else "manual", "confidence": o.get("confidence") if o.get("confidence") in _CONF else "medium",
                "width_assumed": bool(o.get("width_assumed"))}
        if kind == "door":
            dt = o.get("door_type")
            base["door_type"] = dt if dt in ("main", "internal", "bedroom", "bathroom", "utility", "puja_room", "arch") else "internal"
            base["connects_to"] = _s(o.get("connects_to"), 40) or None
        return base
    by = {r["id"]: r for r in rooms}
    doors = [opening(o, "door") for o in doors_in]
    windows = [opening(o, "window") for o in wins_in]
    for d in doors:                                    # the neighbour is always recomputed from the geometry, never trusted
        room = by.get(d["room"])
        if room and d["wall"] and d["width"] > 0:
            n = neighbour_across(rooms, room, d["wall"], d["position"], d["width"])
            d["connects_to"] = n["id"] if n else None
    sc = obj.get("scale") if isinstance(obj.get("scale"), dict) else {}
    scale = {"ft_per_px": sc.get("ft_per_px") if isinstance(sc.get("ft_per_px"), (int, float)) and not isinstance(sc.get("ft_per_px"), bool) else None,
             "source": sc.get("source") if sc.get("source") in ("user_reference", "approved_approximate", "manual") else "manual",
             "approximate": bool(sc.get("approximate")), "description": _s(sc.get("description"), 200)}
    og = sc.get("origin_px")
    if isinstance(og, dict) and all(isinstance(og.get(q), (int, float)) and not isinstance(og.get(q), bool) and 0 <= og[q] <= 40000 for q in ("x", "y")):
        scale["origin_px"] = {"x": float(og["x"]), "y": float(og["y"])}
    strs = lambda k: [t for t in (_s(x, 240) for x in (obj.get(k) if isinstance(obj.get(k), list) else [])[:40]) if t]
    draft = {"version": 1, "scale": scale, "floor_label": _s(obj.get("floor_label"), 60, "Ground Floor"), "rooms": rooms, "doors": doors, "windows": windows,
             "adjustments": strs("adjustments"), "uncertainties": strs("uncertainties"), "assumptions": strs("assumptions")}
    return draft
