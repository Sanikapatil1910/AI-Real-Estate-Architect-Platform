"""Convert an engine PlanSol into the project's existing plan schema (real coordinates)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from backend.planner.style_knowledge import canonical_style, style_design_notes
from backend.planner.architect.engine import PROFILE_LABEL, PlanSol, _profile_score
from backend.planner.architect.geometry import Room
from backend.planner.architect.rules import BEDROOM_TYPES, DISPLAY
from backend.planner.architect.rules import CAR_BAY_L, CAR_BAY_W
from backend.planner.architect.site import PARKING_BAY_L, PARKING_BAY_W, Site

STRATEGY_TEXT = {
    "balanced_zoning": "Balanced zoning: public rooms at the road, private rooms behind.",
    "vastu_aligned": "Vastu-aligned: the variant whose room zones best match the Vastu rule base.",
    "light_and_ventilation": "Light and air: most habitable rooms get two exterior walls.",
    "compact_circulation": "Compact circulation: shortest door paths and tight wet-room clusters.",
}
TOPOLOGY = {
    "rows": "front_to_back_bands",
    "cols": "side_by_side_wings",
}


class Mapper:
    """Canonical (u, v) -> real plot coordinates for one plan."""

    def __init__(self, site: Site, yard: float, u_off: float = 0.0):
        self.site = site
        self.ox = site.left + u_off
        self.oy = site.front + yard

    def rect(self, u: float, v: float, w: float, d: float) -> Tuple[float, float, float, float]:
        return self.site.rect_to_real(self.ox + u, self.oy + v, w, d)

    def point(self, u: float, v: float) -> Tuple[float, float]:
        x, y, _, _ = self.site.rect_to_real(self.ox + u, self.oy + v, 0.0, 0.0)
        return x, y


def _r2(x: float) -> float:
    return round(x + 0.0, 2)


def _room_dict(r: Room, m: Mapper) -> Dict[str, Any]:
    x, y, w, l = m.rect(r.u, r.v, r.w, r.d)
    return {
        "id": r.id, "name": r.name, "room_type": r.type,
        "width": _r2(w), "length": _r2(l), "area": _r2(w * l),
        "x": _r2(x), "y": _r2(y), "x2": _r2(x + w), "y2": _r2(y + l),
        "floor_index": r.floor, "attached_to": r.attached_to,
    }


def _wall_of(room: Dict[str, Any], p1: Tuple[float, float], p2: Tuple[float, float]):
    """Which wall of `room` the segment p1-p2 lies on, and its position along it."""
    eps = 0.26
    x1, y1 = p1
    x2, y2 = p2
    if abs(y1 - y2) < eps:                       # horizontal segment
        lo = min(x1, x2)
        if abs(y1 - room["y"]) < eps:
            return "top", lo - room["x"]
        if abs(y1 - room["y2"]) < eps:
            return "bottom", lo - room["x"]
    if abs(x1 - x2) < eps:                       # vertical segment
        lo = min(y1, y2)
        if abs(x1 - room["x"]) < eps:
            return "left", lo - room["y"]
        if abs(x1 - room["x2"]) < eps:
            return "right", lo - room["y"]
    return None, 0.0


def _openings(fs, rooms: List[Dict[str, Any]], m: Mapper, root: str, ground: bool) -> Dict[str, Any]:
    by_id = {r["id"]: r for r in rooms}
    doors, windows = [], []
    for d in fs.ev.plan.doors:
        p1 = m.point(*d.p1)
        p2 = m.point(*d.p2)
        for rid, other in ((d.a, d.b), (d.b, d.a)):
            if rid is None:
                continue
            room = by_id[rid]
            wall, pos = _wall_of(room, p1, p2)
            if wall is None:
                continue
            doors.append({
                "room": rid, "room_type": room["room_type"], "wall": wall,
                "position": _r2(pos), "width": _r2(d.width),
                "door_type": d.kind, "connects_to": other,
                "x1": _r2(p1[0]), "y1": _r2(p1[1]), "x2": _r2(p2[0]), "y2": _r2(p2[1]),
            })
            break                                   # one drawn leaf per opening
    for w in fs.ev.plan.windows:
        p1 = m.point(*w.p1)
        p2 = m.point(*w.p2)
        room = by_id.get(w.room)
        if not room:
            continue
        wall, pos = _wall_of(room, p1, p2)
        if wall is None:
            continue
        windows.append({"room": w.room, "room_type": room["room_type"], "wall": wall,
                        "position": _r2(pos), "width": _r2(w.width), "sill": _r2(w.sill), "height": _r2(w.height)})
    main = next((d for d in doors if d["door_type"] == "main"), None)
    graph = {k: list(v) for k, v in fs.ev.plan.graph.items()}
    reach, queue = {root}, [root]
    while queue:
        cur = queue.pop()
        for nx in graph.get(cur, []):
            if nx not in reach:
                reach.add(nx); queue.append(nx)
    return {
        "valid": True, "errors": [], "doors": doors, "windows": windows,
        "entrance": ({"room": main["room"], "wall": main["wall"], "position": main["position"],
                      "width": main["width"], "valid": True} if main else None),
        "circulation": {"graph": graph, "entry_room": root, "reachable_rooms": sorted(reach),
                        "connected": len(reach) == len(graph), "valid": True, "errors": []},
    }


def _ducts(rooms: List[Dict[str, Any]], doors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Pipe shaft (duct) of every bathroom / toilet: a 1.5 x 2 ft corner on the room's outer wall."""
    solid = [r for r in rooms if r["room_type"] not in ("open_terrace", "balcony")]
    if not solid:
        return []
    x0 = min(r["x"] for r in solid); y0 = min(r["y"] for r in solid)
    x1 = max(r["x2"] for r in solid); y1 = max(r["y2"] for r in solid)
    out = []
    for r in rooms:
        if r["room_type"] not in ("bathroom", "toilet"):
            continue
        sides = [s_ for s_, hit in (("left", abs(r["x"] - x0) < 0.05), ("right", abs(r["x2"] - x1) < 0.05),
                                    ("top", abs(r["y"] - y0) < 0.05), ("bottom", abs(r["y2"] - y1) < 0.05)) if hit]
        side = sides[0] if sides else "top"
        along = (r["length"] if side in ("left", "right") else r["width"])
        dw, dl = 1.5, 2.0                                   # depth into the room, length along the wall
        door_spans = []
        for d in doors:
            if d.get("room") == r["id"] and d.get("wall") == side:
                door_spans.append((d["position"], d["position"] + d["width"]))
        best = None
        for at_start in (True, False):
            a0 = 0.0 if at_start else along - dl
            if all(a0 + dl <= lo + 0.2 or a0 >= hi - 0.2 for lo, hi in door_spans):
                best = a0
                break
        a0 = best if best is not None else 0.0
        if side == "left":
            rect = (r["x"], r["y"] + a0, dw, dl)
        elif side == "right":
            rect = (r["x2"] - dw, r["y"] + a0, dw, dl)
        elif side == "top":
            rect = (r["x"] + a0, r["y"], dl, dw)
        else:
            rect = (r["x"] + a0, r["y2"] - dw, dl, dw)
        out.append({"room": r["id"], "side": side, "x": _r2(rect[0]), "y": _r2(rect[1]),
                    "width": _r2(rect[2]), "length": _r2(rect[3])})
    return out


def _regions(site: Site, yard: float, F: float, D: float, ground: bool, u_off: float):
    """Open (unbuilt) regions of the plot in real coordinates."""
    m = Mapper(site, yard)
    out = []
    uf, ud = site.usable_frontage, site.usable_depth
    # front yard (parking / garden) across the whole usable frontage
    if yard > 0.4:
        x, y, w, l = site.rect_to_real(site.left, site.front, uf, yard)
        out.append({"type": "front_yard", "x": _r2(x), "y": _r2(y), "width": _r2(w),
                    "length": _r2(l), "area": _r2(w * l)})
    # rear strip when the footprint is shallower than the plot
    rear = ud - yard - D
    if rear > 0.4:
        x, y, w, l = site.rect_to_real(site.left, site.front + yard + D, uf, rear)
        out.append({"type": "rear_garden", "x": _r2(x), "y": _r2(y), "width": _r2(w),
                    "length": _r2(l), "area": _r2(w * l)})
    for u0, wd in ((0.0, u_off), (u_off + F, uf - F - u_off)):
        if wd > 0.4:
            x, y, w, l = site.rect_to_real(site.left + u0, site.front + yard, wd, D)
            out.append({"type": "side_garden", "x": _r2(x), "y": _r2(y), "width": _r2(w),
                        "length": _r2(l), "area": _r2(w * l)})
    return out


def _parking_block(rooms: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The covered car porch is a real room of the ground floor; expose it as the parking region too."""
    pk = next((r for r in rooms if r["room_type"] in ("parking", "bike_parking")), None)
    if pk is None:
        return None
    return {"room_type": "parking", "x": pk["x"], "y": pk["y"], "width": pk["width"], "length": pk["length"],
            "spaces": 1, "covered": True}


def car_bays(room: Dict[str, Any], road_side: str, cars: int) -> List[Dict[str, Any]]:
    """The marked car bays inside a ground-floor car porch: `cars` bays of CAR_BAY_W x (up to PARKING_BAY_L), side by side
    across the frontage, centred in the porch, flush with the road edge (the car drives in from the road).  Real
    coordinates (x east, y south).  The porch itself is a room of the plan, so the bays can never overlap another room."""
    if cars <= 0 or room is None:
        return []
    along_x = road_side in ("North", "South")                       # frontage runs along x
    across = room["width"] if along_x else room["length"]
    depth = room["length"] if along_x else room["width"]
    n = min(cars, int(across // CAR_BAY_W + 1e-6))
    d = min(depth, PARKING_BAY_L)
    off = (across - n * CAR_BAY_W) / 2.0
    out = []
    for k in range(n):
        a = off + k * CAR_BAY_W
        if along_x:
            x, w, l = room["x"] + a, CAR_BAY_W, d
            y = room["y"] if road_side == "North" else room["y"] + room["length"] - d
        else:
            y, w, l = room["y"] + a, d, CAR_BAY_W
            x = room["x"] if road_side == "West" else room["x"] + room["width"] - d
        out.append({"index": k + 1, "x": _r2(x), "y": _r2(y), "width": _r2(w), "length": _r2(l)})
    return out


def parking_report(declared: Optional[Dict[str, Any]], ground_rooms: List[Dict[str, Any]], road_side: str) -> Optional[Dict[str, Any]]:
    """The plan's `parking` entry: what was asked for plus where the bays really are (empty list = nothing was placed)."""
    if declared is None:
        return None
    out = dict(declared)
    pk = next((r for r in ground_rooms if r["room_type"] == "parking"), None)
    cars = int(declared.get("cars") or 0)
    bays = car_bays(pk, road_side, cars) if pk else []
    out["bays"] = bays
    out["room_id"] = pk["id"] if pk else None
    out["placed"] = (len(bays) == cars) and (cars == 0 or pk is not None)
    out["bay_width"] = CAR_BAY_W
    out["bay_length"] = CAR_BAY_L
    return out


def _parking_block_old(site: Site, yard: float) -> Optional[Dict[str, Any]]:
    if not site.parking_spaces:
        return None
    uf = site.usable_frontage
    per_row = max(1, int(uf // PARKING_BAY_W))
    cols = min(per_row, site.parking_spaces)
    rows = -(-site.parking_spaces // per_row)
    w = cols * PARKING_BAY_W
    d = rows * PARKING_BAY_L
    u0 = site.left + (uf - w) / 2
    x, y, rw, rl = site.rect_to_real(u0, site.front, w, d)
    return {"room_type": "parking", "x": _r2(x), "y": _r2(y), "width": _r2(rw),
            "length": _r2(rl), "spaces": site.parking_spaces}


def _explain(plan: PlanSol, floors: List[Dict[str, Any]], site: Site, mode: str) -> List[str]:
    lines = [STRATEGY_TEXT.get(plan.label, plan.label)]
    f0 = plan.floors[0].rooms
    living = next((r for r in f0 if r.type == "living_room"), None)
    if living:
        lines.append(f"The living room sits on the {site.road_side.lower()} road side and holds the main door.")
    if len(plan.floors) > 1:
        lines.append("The staircase occupies the same position on every floor, so the flight lines up.")
    beds = sum(1 for fl in plan.floors for r in fl.rooms if r.type in BEDROOM_TYPES)
    baths = sum(1 for fl in plan.floors for r in fl.rooms if r.type == "bathroom")
    lines.append(f"{beds} bedroom(s) and {baths} bathroom(s) are placed; every bedroom has an exterior wall for light.")
    if mode != "no_preference":
        lines.append(f"Vastu match for this variant: {plan.vastu * 100:.0f}% (mode: {mode}).")
    if plan.program is not None:
        lines.extend(plan.program.warnings)
    return lines


def plan_to_legacy(plan: PlanSol, number: int, site: Site, yard: float, mode: str,
                   payload: Dict[str, Any], budget: Dict[str, Any]) -> Dict[str, Any]:
    from backend.planner.architect.engine import _plan_feats
    m = Mapper(site, yard, plan.u_off)
    prog = plan.program
    plot = {"width": site.plot_w, "length": site.plot_l, "area": round(site.plot_w * site.plot_l, 2),
            "x": 0.0, "y": 0.0}
    uu = site.usable_real()
    usable_base = {**uu, "x": uu["x"], "y": uu["y"]}
    floors_out: List[Dict[str, Any]] = []
    validation = []
    nfl = len(plan.floors)
    names_ = [prog.floors[k].name if prog else f"Floor {k}" for k in range(nfl)]
    for i, fs in enumerate(plan.floors):
        name = prog.floors[i].name if prog else f"Floor {i}"
        rooms = [_room_dict(r, m) for r in fs.rooms if r.type != "open_terrace"]
        # the engine's `open_terrace` cells are only the part of an upper floor its rooms do not fill: the open flat roof of the floor below.
        # They are published as roof areas -- never as rooms, terraces or anything with a door.
        roof_cells = [_room_dict(r, m) for r in fs.rooms if r.type == "open_terrace"]
        rooms_all = rooms
        used = sum(r["area"] for r in rooms)
        usable = dict(usable_base)
        regs = _regions(site, yard, plan.F, plan.D, i == 0, plan.u_off)
        parking_blk = _parking_block(rooms_all) if i == 0 else None
        if parking_blk:
            parking_blk["spaces"] = int(payload.get("parking_spaces", 1) or 1)
            pk_room = next((r for r in rooms_all if r["room_type"] == "parking"), None)
            parking_blk["bays"] = car_bays(pk_room, site.road_side, int((budget.get("parking") or {}).get("cars") or 0))
            usable["reserved_regions"] = [parking_blk]
        root = getattr(fs.ev.plan, "root", None) or ("living_room" if i == 0 else "staircase")
        if not any(r["id"] == root for r in rooms_all):
            root = rooms_all[0]["id"]
        opening = _openings(fs, rooms + roof_cells, m, root, i == 0)
        if roof_cells:
            vids = {v["id"] for v in roof_cells}
            opening["doors"] = [d for d in opening["doors"] if d["room"] not in vids and d["connects_to"] not in vids]
            opening["windows"] = [w for w in opening["windows"] if w["room"] not in vids]
            g_ = {k: [n for n in v if n not in vids] for k, v in opening["circulation"]["graph"].items() if k not in vids}
            reach_, q_ = {root}, [root]
            while q_:
                c_ = q_.pop()
                for n_ in g_.get(c_, []):
                    if n_ not in reach_:
                        reach_.add(n_); q_.append(n_)
            opening["circulation"].update({"graph": g_, "reachable_rooms": sorted(reach_), "connected": len(reach_) == len(g_)})
        layout: Dict[str, Any] = {
            "rooms": rooms_all, "plot": plot, "usable_plot": usable,
            "used_room_area": _r2(used),
            "remaining_area": _r2(max(0.0, usable["area"] - used)),
            "valid": True, "errors": [], "road_side": site.road_side,
            "openings": opening,
            "open_spaces": {"valid": True, "regions": regs if i == 0 else [], "errors": [],
                            "total_usable_area": usable["area"], "occupied_room_area": _r2(used),
                            "remaining_unused_area": _r2(max(0.0, usable["area"] - used))},
            "front_public": {"strategy": plan.label, "entrance_room": "living_room" if i == 0 else None},
        }
        layout["ducts"] = _ducts(rooms_all, opening["doors"])
        layout["roof_areas"] = [{"id": v["id"].replace("open_terrace", "flat_roof"), "name": "Flat roof (not accessible)", "x": v["x"], "y": v["y"],
                                 "x2": v["x2"], "y2": v["y2"], "width": v["width"], "length": v["length"], "area": v["area"],
                                 "over": names_[i - 1] if i > 0 else None} for v in roof_cells]
        bal = next((r for r in rooms_all if r["room_type"] == "balcony"), None)
        layout["balcony"] = ({"exists": True, "x": bal["x"], "y": bal["y"], "width": bal["width"],
                              "length": bal["length"], "attached_to": "bedroom"}
                             if bal else {"exists": False})
        gard = next((g for g in regs if g["type"] in ("rear_garden", "side_garden", "front_yard")), None)
        if i == 0 and payload.get("garden_required") and gard:
            layout["garden"] = {"exists": True, **{k: gard[k] for k in ("x", "y", "width", "length")}}
        else:
            layout["garden"] = {"exists": False}
        feats = fs.ev.features
        func = 100.0 * (0.25 * feats["zoning"] + 0.25 * feats["adjacency"] + 0.15 * feats["circulation"]
                        + 0.15 * feats["proportion"] + 0.1 * feats["service"] + 0.1 * feats["privacy"])
        vast = 100.0 * plan.vastu
        validation.append({
            "floor": name,
            "validation": {
                "valid": True, "errors": [], "warnings": list(prog.warnings) if (prog and i == 0) else [],
                "overall_score": round(func, 1),
                "scores": {"functional": round(func, 1), "vastu": round(vast, 1),
                           "daylight": round(100 * feats["daylight"], 1),
                           "circulation": round(100 * feats["circulation"], 1)},
                "quality_5factor": {"overall_score": round(func, 1), "factors": {
                    k: round(100 * v, 1) for k, v in feats.items()}},
            },
        })
        floors_out.append({"floor": name, "layout": layout, "room_count": len(rooms_all)})

    # roof terrace over the whole footprint
    fx, fy, fw, fl = m.rect(0.0, 0.0, plan.F, plan.D)
    include_terrace = bool(payload.get("include_terrace", False)) and nfl >= 1      # a terrace exists only when the user asked for one
    terrace = {"exists": include_terrace, "x": _r2(fx), "y": _r2(fy), "width": _r2(fw), "length": _r2(fl),
               "features": payload.get("terrace_features") or {}, "solar_panels": None, "garden": None}
    score = round(100 * _profile_score(plan, next((k for k, v in PROFILE_LABEL.items() if v == plan.label),
                                                  "balanced")), 1)
    explain = _explain(plan, floors_out, site, mode) + style_design_notes(payload.get("architectural_style"))
    stair = None
    if prog and prog.stair_dims:
        info = getattr(prog, "stair_info", None) or {}
        stair = {"width": prog.stair_dims[0], "length": prog.stair_dims[1]}
        for k in ("riser_count", "riser_height_mm", "tread_depth_mm", "stair_width_feet", "stair_width_mm",
                  "floor_height", "floor_height_mm", "entry_landing_feet", "flights", "landing", "rules_ok"):
            if k in info:
                stair[k] = info[k]
    return {
        "plan_number": number, "strategy": plan.label, "topology": TOPOLOGY.get(plan.family, plan.family),
        "building_type": payload.get("building_type", "Ground"), "vastu_mode": mode,
        "architectural_style": canonical_style(payload.get("architectural_style")),
        "road_side": site.road_side,
        "parking": parking_report(budget.get("parking"), floors_out[0]["layout"]["rooms"] if floors_out else [], site.road_side), "staircase_required": nfl > 1, "staircase": stair,
        "floors": floors_out, "terrace": terrace, "validation": validation,
        "explanation": explain, "quality_score": score, "engine": "architect",
        "passes_90_percent": False, "regeneration_attempts": 1, "best_attempt_index": 1,
        "bedroom_program": {"valid": True}, "master_bathroom": {"valid": True},
        "mirrored": plan.mirror,
    }
