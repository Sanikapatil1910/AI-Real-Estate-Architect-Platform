from typing import Dict, List, Optional, Tuple
from math import hypot

from backend.planner.room_rules import validate_room_dimensions, ROOM_RULES
from backend.planner.relationship_rules import evaluate_room_relationships, room_center
from backend.planner.vastu_rules import evaluate_vastu, score_room_vastu, get_room_zone
from backend.planner.room_connections import get_shared_wall, build_circulation_graph, find_all_connections


def validate_bedroom_program(rooms: List[Dict], required_bedrooms=None) -> Dict:
    """Validate the requested residential bedroom program."""
    bedroom_rooms = [
        room for room in rooms
        if room.get("room_type") in {"master_bedroom", "bedroom"}
    ]
    errors = []
    if required_bedrooms is not None and len(bedroom_rooms) < required_bedrooms:
        errors.append(
            f"Only {len(bedroom_rooms)} of {required_bedrooms} required bedrooms were placed."
        )
    if bedroom_rooms and not any(room.get("room_type") == "master_bedroom" for room in bedroom_rooms):
        errors.append("A residential plan must contain a master bedroom.")
    if required_bedrooms and required_bedrooms > 1 and not any(
        room.get("room_type") == "bedroom" for room in bedroom_rooms
    ):
        errors.append("A plan with multiple bedrooms must contain an additional bedroom.")
    return {"valid": not errors, "errors": errors, "bedroom_count": len(bedroom_rooms)}


def validate_functional_connections(layout: Dict) -> Dict:
    """Report physical shared-wall connections without inventing graph edges."""
    rooms = layout.get("rooms", [])
    pairs = (
        ("living_room", "dining"),
        ("dining", "kitchen"),
        ("kitchen", "utility"),
    )
    checks = []
    for first_type, second_type in pairs:
        first = next((room for room in rooms if room.get("room_type") == first_type), None)
        second = next((room for room in rooms if room.get("room_type") == second_type), None)
        checks.append({
            "connection": f"{first_type}->{second_type}",
            "valid": bool(first and second and get_shared_wall(first, second)),
        })
    return {"valid": all(item["valid"] for item in checks), "checks": checks}


def validate_master_bathroom(rooms: List[Dict], bathroom_required=False) -> Dict:
    """Check the existing master-bedroom to private-bathroom contract."""
    master = next((room for room in rooms if room.get("room_type") == "master_bedroom"), None)
    bathrooms = [room for room in rooms if room.get("room_type") == "bathroom"]
    attached = any(
        room.get("attached_to") == "master_bedroom"
        or (master and get_shared_wall(master, room))
        for room in bathrooms
    )
    valid = not bathroom_required or not master or attached
    return {
        "valid": valid,
        "required": bool(bathroom_required and master),
        "attached": attached,
        "message": "Master bedroom has a private bathroom connection."
        if attached else "Master bedroom has no attached/private bathroom connection.",
    }


def check_room_inside_usable_plot(
    room: Dict,
    usable_plot: Dict
) -> Dict:
    """
    Check whether a room is completely inside
    the usable construction area.
    """

    room_left = room["x"]
    room_bottom = room["y"]
    room_right = room["x2"]
    room_top = room["y2"]

    plot_left = usable_plot["x"]
    plot_bottom = usable_plot["y"]
    plot_right = plot_left + usable_plot["width"]
    plot_top = plot_bottom + usable_plot["length"]

    valid = (
        room_left >= plot_left
        and room_bottom >= plot_bottom
        and room_right <= plot_right
        and room_top <= plot_top
    )

    return {
        "valid": valid,
        "room_type": room["room_type"],
        "message": (
            "Room is inside usable construction area."
            if valid
            else "Room extends outside usable construction area."
        )
    }


def check_room_overlaps(
    rooms: List[Dict]
) -> List[Dict]:
    """
    Check whether any two rooms overlap.
    """

    overlaps = []

    for i in range(len(rooms)):

        for j in range(i + 1, len(rooms)):

            room_a = rooms[i]
            room_b = rooms[j]

            # Rectangle overlap test
            separated = (
                room_a["x2"] <= room_b["x"]
                or room_b["x2"] <= room_a["x"]
                or room_a["y2"] <= room_b["y"]
                or room_b["y2"] <= room_a["y"]
            )

            if not separated:

                overlaps.append({
                    "room_a": room_a["room_type"],
                    "room_b": room_b["room_type"],
                    "valid": False,
                    "message": "Rooms overlap."
                })

    return overlaps


def validate_room_dimensions_in_layout(
    rooms: List[Dict]
) -> List[Dict]:
    """
    Validate dimensions of every room.
    """

    results = []

    for room in rooms:

        result = validate_room_dimensions(
            room["room_type"],
            room["width"],
            room["length"]
        )

        results.append(result)

    return results


# ============================================================
# DEAD SPACE DETECTION
# ============================================================

def detect_dead_spaces(
    rooms: List[Dict],
    usable_plot: Dict,
    grid_step: float = 1.0,
) -> Dict:
    """
    Detect unused buildable area (dead spaces) using grid sampling.

    Returns fraction of unused area and identifies dead space cells.
    """
    px = float(usable_plot["x"])
    py = float(usable_plot["y"])
    pw = float(usable_plot["width"])
    pl = float(usable_plot["length"])

    if pw <= 0 or pl <= 0:
        return {"dead_space_ratio": 0.0, "used_cells": 0, "total_cells": 0, "score": 100.0}

    total_cells = 0
    used_cells = 0

    gx = px
    while gx < px + pw - 0.001:
        gy = py
        while gy < py + pl - 0.001:
            total_cells += 1
            cx = gx + grid_step / 2.0
            cy = gy + grid_step / 2.0
            for room in rooms:
                rx = float(room["x"])
                ry = float(room["y"])
                rx2 = float(room.get("x2", rx + float(room["width"])))
                ry2 = float(room.get("y2", ry + float(room["length"])))
                if rx <= cx <= rx2 and ry <= cy <= ry2:
                    used_cells += 1
                    break
            gy += grid_step
        gx += grid_step

    if total_cells == 0:
        return {"dead_space_ratio": 0.0, "used_cells": 0, "total_cells": 0, "score": 100.0}

    used_ratio = used_cells / total_cells
    dead_space_ratio = 1.0 - used_ratio

    if used_ratio >= 0.90:
        score = 100.0
    elif used_ratio >= 0.80:
        score = 90.0 + (used_ratio - 0.80) * 100.0
    elif used_ratio >= 0.70:
        score = 75.0 + (used_ratio - 0.70) * 150.0
    elif used_ratio >= 0.55:
        score = 50.0 + (used_ratio - 0.55) * 166.67
    else:
        score = max(0.0, used_ratio * 90.0)

    return {
        "dead_space_ratio": round(dead_space_ratio, 4),
        "used_ratio": round(used_ratio, 4),
        "used_cells": used_cells,
        "total_cells": total_cells,
        "score": round(score, 2),
    }


# ============================================================
# SPACE EFFICIENCY SCORING
# ============================================================

def score_space_efficiency(
    rooms: List[Dict],
    usable_plot: Dict,
) -> Dict:
    """
    Score efficient usage of buildable area.

    Combines: coverage ratio, dead-space detection,
    balanced distribution, and absence of narrow gaps.
    """
    if not rooms:
        return {"score": 0.0, "coverage": 0.0, "dead_space": 0.0, "distribution": 0.0}

    px, py = float(usable_plot["x"]), float(usable_plot["y"])
    pw, pl = float(usable_plot["width"]), float(usable_plot["length"])
    plot_area = pw * pl

    used_area = sum(float(r.get("area", float(r["width"]) * float(r["length"]))) for r in rooms)
    coverage = used_area / plot_area if plot_area > 0 else 0.0

    if 0.70 <= coverage <= 0.88:
        coverage_score = 100.0
    elif 0.60 <= coverage < 0.70:
        coverage_score = 80.0 + (coverage - 0.60) * 200.0
    elif 0.88 < coverage <= 0.95:
        coverage_score = 100.0 - (coverage - 0.88) * 300.0
    elif coverage > 0.95:
        coverage_score = max(40.0, 82.0 - (coverage - 0.95) * 800.0)
    else:
        coverage_score = max(20.0, coverage * 133.33)

    dead = detect_dead_spaces(rooms, usable_plot)

    centers = [room_center(r) for r in rooms]
    avg_x = sum(c[0] for c in centers) / len(centers)
    avg_y = sum(c[1] for c in centers) / len(centers)
    diag = hypot(pw, pl) if pw > 0 and pl > 0 else 1.0
    center_dist = hypot((avg_x - (px + pw / 2.0)), (avg_y - (py + pl / 2.0))) / (diag * 0.5) if diag > 0 else 1.0
    distribution_score = max(0.0, 100.0 - center_dist * 140.0)

    overall = round(
        coverage_score * 0.40
        + dead["score"] * 0.35
        + distribution_score * 0.25,
        2,
    )

    return {
        "score": overall,
        "coverage_score": round(coverage_score, 2),
        "coverage_ratio": round(coverage, 4),
        "dead_space_score": round(dead["score"], 2),
        "dead_space_ratio": dead["dead_space_ratio"],
        "distribution_score": round(distribution_score, 2),
    }


# ============================================================
# CIRCULATION SCORING
# ============================================================

def score_circulation(
    rooms: List[Dict],
    usable_plot: Dict,
    road_side: str = "North",
) -> Dict:
    """
    Score circulation quality.

    Evaluates:
    1. Entry -> Living -> Dining -> Kitchen chain continuity
    2. Small central lobby / circulation zone existence
    3. Public rooms on road-facing side
    4. Bedroom privacy (separation from entry)
    5. Staircase connection to common zone
    """
    if not rooms:
        return {
            "score": 0.0, "chain_score": 0.0, "lobby_score": 0.0,
            "road_score": 0.0, "privacy_score": 0.0, "stair_score": 0.0,
        }

    def find_room(t):
        return next((r for r in rooms if r["room_type"] == t), None)

    living = find_room("living_room")
    dining = find_room("dining")
    kitchen = find_room("kitchen")
    utility = find_room("utility")
    staircase = find_room("staircase")
    bedrooms = [r for r in rooms if r["room_type"] in {"master_bedroom", "bedroom", "guest_bedroom"}]

    chain = [
        ("living_room", "dining", living, dining),
        ("dining", "kitchen", dining, kitchen),
        ("kitchen", "utility", kitchen, utility),
    ]
    chain_connected = 0
    chain_total = 0
    for a_t, b_t, a, b in chain:
        if a is None or b is None:
            if a_t == "kitchen" and b_t == "utility":
                continue
            chain_total += 1
            continue
        chain_total += 1
        if get_shared_wall(a, b):
            chain_connected += 1
    chain_score = (chain_connected / chain_total * 100.0) if chain_total > 0 else 100.0

    px, py = float(usable_plot["x"]), float(usable_plot["y"])
    pw, pl = float(usable_plot["width"]), float(usable_plot["length"])
    cx, cy = px + pw / 2.0, py + pl / 2.0

    common_rooms = [r for r in rooms if r["room_type"] in {"living_room", "dining", "kitchen"}]
    if common_rooms:
        common_centers = [room_center(r) for r in common_rooms]
        ccx = sum(c[0] for c in common_centers) / len(common_centers)
        ccy = sum(c[1] for c in common_centers) / len(common_centers)
        diag = hypot(pw, pl) if pw > 0 and pl > 0 else 1.0
        central_dist = hypot(ccx - cx, ccy - cy) / (diag * 0.5) if diag > 0 else 1.0
        lobby_score = max(0.0, 100.0 - central_dist * 160.0)
        if len(common_rooms) >= 2:
            max_d = 0.0
            for i, a in enumerate(common_centers):
                for b in common_centers[i + 1:]:
                    d = hypot(a[0] - b[0], a[1] - b[1])
                    if d > max_d:
                        max_d = d
            spread = max_d / (diag * 0.5) if diag > 0 else 0.0
            if spread <= 0.35:
                lobby_score = min(100.0, lobby_score + 15.0)
            elif spread <= 0.50:
                lobby_score = min(100.0, lobby_score + 7.0)
    else:
        lobby_score = 40.0

    road = str(road_side or "North").lower()
    public_rooms = [r for r in rooms if r["room_type"] in {"living_room", "dining"}]
    if public_rooms:
        distances = []
        for r in public_rooms:
            rx, ry = room_center(r)
            if road == "north":
                d = (ry - py - float(r["length"]) / 2.0) / max(pl, 1.0)
            elif road == "south":
                d = (py + pl - ry - float(r["length"]) / 2.0) / max(pl, 1.0)
            elif road == "east":
                d = (px + pw - rx - float(r["width"]) / 2.0) / max(pw, 1.0)
            else:
                d = (rx - px - float(r["width"]) / 2.0) / max(pw, 1.0)
            distances.append(max(0.0, d))
        avg_d = sum(distances) / len(distances)
        road_score = max(0.0, 100.0 - avg_d * 220.0)
    else:
        road_score = 50.0

    if living and bedrooms:
        living_center = room_center(living)
        bd_centers = [room_center(b) for b in bedrooms]
        diag = hypot(pw, pl) if pw > 0 and pl > 0 else 1.0
        avg_dist = sum(hypot(living_center[0] - c[0], living_center[1] - c[1]) for c in bd_centers) / len(bd_centers)
        norm = avg_dist / (diag * 0.35) if diag > 0 else 0.0
        if 0.25 <= norm <= 0.70:
            privacy_score = 100.0
        elif norm < 0.25:
            privacy_score = max(50.0, 100.0 - (0.25 - norm) * 200.0)
        else:
            privacy_score = max(60.0, 100.0 - (norm - 0.70) * 150.0)
    else:
        privacy_score = 80.0 if bedrooms else 100.0

    if staircase:
        stair_center = room_center(staircase)
        common_for_stair = [r for r in rooms if r["room_type"] in {"living_room", "dining", "kitchen", "utility"}]
        if common_for_stair:
            distances = [hypot(stair_center[0] - room_center(c)[0], stair_center[1] - room_center(c)[1]) for c in common_for_stair]
            min_d = min(distances)
            diag = hypot(pw, pl) if pw > 0 and pl > 0 else 1.0
            norm_d = min_d / (diag * 0.25) if diag > 0 else 0.0
            connected = any(get_shared_wall(staircase, c) for c in common_for_stair)
            if connected:
                stair_score = 100.0
            else:
                stair_score = max(50.0, 100.0 - norm_d * 120.0)
        else:
            stair_score = 70.0
    else:
        stair_score = 100.0

    overall = round(
        chain_score * 0.30
        + lobby_score * 0.22
        + road_score * 0.18
        + privacy_score * 0.15
        + stair_score * 0.15,
        2,
    )

    return {
        "score": overall,
        "chain_score": round(chain_score, 2),
        "lobby_score": round(lobby_score, 2),
        "road_score": round(road_score, 2),
        "privacy_score": round(privacy_score, 2),
        "stair_score": round(stair_score, 2),
    }


# ============================================================
# ROOM CORRECTNESS SCORING
# ============================================================

def score_room_correctness(
    rooms: List[Dict],
    required_bedrooms: Optional[int] = None,
    required_bathrooms: Optional[int] = None,
) -> Dict:
    """
    Score room correctness: exact counts, proper proportions,
    master > secondary, bathrooms smaller than bedrooms,
    aspect ratios within limits, dimension rules compliance.
    """
    if not rooms:
        return {"score": 0.0, "count_score": 0.0, "proportion_score": 0.0, "dimension_score": 0.0}

    errors = 0.0
    count_checks = 0.0

    bedrooms = [r for r in rooms if r["room_type"] in {"master_bedroom", "bedroom", "guest_bedroom"}]
    master = next((r for r in rooms if r["room_type"] == "master_bedroom"), None)
    secondaries = [r for r in rooms if r["room_type"] in {"bedroom", "guest_bedroom"}]
    bathrooms = [r for r in rooms if r["room_type"] == "bathroom"]
    living = next((r for r in rooms if r["room_type"] == "living_room"), None)
    dining = next((r for r in rooms if r["room_type"] == "dining"), None)
    kitchen = next((r for r in rooms if r["room_type"] == "kitchen"), None)

    if required_bedrooms is not None:
        count_checks += 1.0
        if len([r for r in rooms if r["room_type"] in {"master_bedroom", "bedroom"}]) >= required_bedrooms:
            pass
        else:
            errors += 1.0
    if required_bathrooms is not None:
        count_checks += 1.0
        if len(bathrooms) >= required_bathrooms:
            pass
        else:
            errors += 1.0

    if required_bedrooms and required_bedrooms > 1:
        count_checks += 1.0
        if not master or not secondaries:
            errors += 1.0
    elif bedrooms:
        count_checks += 1.0
        if not master:
            errors += 0.5

    if living:
        count_checks += 0.5
    else:
        errors += 0.5
    if dining:
        count_checks += 0.5
    else:
        errors += 0.5
    if kitchen:
        count_checks += 0.5
    else:
        errors += 0.5

    count_score = max(0.0, (1.0 - (errors / max(count_checks, 1.0))) * 100.0)

    proportion_errors = 0.0
    proportion_checks = 0.0

    if master and secondaries:
        proportion_checks += 1.0
        master_area = float(master.get("area", master["width"] * master["length"]))
        min_sec = min(float(s.get("area", s["width"] * s["length"])) for s in secondaries)
        if master_area < (min_sec * 0.95):
            proportion_errors += 1.0

    if bedrooms and bathrooms and living:
        proportion_checks += len(bathrooms)
        living_area = float(living.get("area", living["width"] * living["length"]))
        for bath in bathrooms:
            ba = float(bath.get("area", bath["width"] * bath["length"]))
            if ba >= living_area * 0.5:
                proportion_errors += 1.0

    if bedrooms and bathrooms:
        proportion_checks += len(bathrooms)
        min_bd = min(float(b.get("area", b["width"] * b["length"])) for b in bedrooms)
        for bath in bathrooms:
            ba = float(bath.get("area", bath["width"] * bath["length"]))
            if ba >= min_bd * 0.8:
                proportion_errors += 0.5

    proportion_score = max(0.0, (1.0 - (proportion_errors / max(proportion_checks, 1.0))) * 100.0)

    dim_errors = 0.0
    dim_checks = 0.0
    for room in rooms:
        dim_checks += 1.0
        w = float(room["width"])
        l = float(room["length"])
        rt = room["room_type"]
        rule = ROOM_RULES.get(rt)
        if rule:
            aspect = max(w, l) / min(w, l) if min(w, l) > 0 else 999.0
            if aspect > rule.get("max_aspect_ratio", 2.5):
                dim_errors += 0.4
            if w < rule.get("min_width", 1.0) - 0.001:
                dim_errors += 0.3
            if l < rule.get("min_length", 1.0) - 0.001:
                dim_errors += 0.3
        else:
            aspect = max(w, l) / min(w, l) if min(w, l) > 0 else 999.0
            if aspect > 3.0:
                dim_errors += 0.5

    dimension_score = max(0.0, (1.0 - (dim_errors / max(dim_checks, 1.0))) * 100.0)

    overall = round(
        count_score * 0.40
        + proportion_score * 0.30
        + dimension_score * 0.30,
        2,
    )

    return {
        "score": overall,
        "count_score": round(count_score, 2),
        "proportion_score": round(proportion_score, 2),
        "dimension_score": round(dimension_score, 2),
        "bedroom_count": len([r for r in rooms if r["room_type"] in {"master_bedroom", "bedroom"}]),
        "bathroom_count": len(bathrooms),
    }


# ============================================================
# CONNECTIVITY SCORING
# ============================================================

def score_connectivity(
    rooms: List[Dict],
    usable_plot: Dict,
) -> Dict:
    """
    Score room connectivity: graph connectedness, shared walls
    between functionally related rooms, master-bath adjacency.
    """
    if not rooms:
        return {"score": 0.0, "graph_score": 0.0, "adjacency_score": 0.0, "master_bath_score": 0.0}

    room_types = {r["room_type"] for r in rooms}
    connections = find_all_connections(rooms)
    graph = build_circulation_graph(rooms)

    entry_candidates = [
        r for r in rooms
        if r["room_type"] in {"living_room", "foyer", "dining"}
    ]
    if entry_candidates:
        entry = entry_candidates[0]["room_type"]
        reachable = {entry}
        pending = [entry]
        while pending:
            cur = pending.pop()
            for nxt in graph.get(cur, []):
                if nxt not in reachable:
                    reachable.add(nxt)
                    pending.append(nxt)
        graph_score = (len(reachable) / len(graph) * 100.0) if graph else 100.0
    else:
        graph_score = 80.0

    required_adjacencies = [
        ("living_room", "dining"),
        ("dining", "kitchen"),
        ("kitchen", "utility"),
    ]
    adj_total = 0
    adj_met = 0
    for a, b in required_adjacencies:
        if a in room_types and b in room_types:
            adj_total += 1
            ra = next((r for r in rooms if r["room_type"] == a), None)
            rb = next((r for r in rooms if r["room_type"] == b), None)
            if ra and rb and get_shared_wall(ra, rb):
                adj_met += 1
    adjacency_score = (adj_met / adj_total * 100.0) if adj_total > 0 else 100.0

    master = next((r for r in rooms if r["room_type"] == "master_bedroom"), None)
    bathrooms = [r for r in rooms if r["room_type"] == "bathroom"]
    if master and bathrooms:
        attached = any(
            b.get("attached_to") == "master_bedroom"
            or get_shared_wall(master, b)
            for b in bathrooms
        )
        master_bath_score = 100.0 if attached else 55.0
    else:
        master_bath_score = 100.0 if not bathrooms else 80.0

    overall = round(
        graph_score * 0.35
        + adjacency_score * 0.40
        + master_bath_score * 0.25,
        2,
    )

    return {
        "score": overall,
        "graph_score": round(graph_score, 2),
        "adjacency_score": round(adjacency_score, 2),
        "master_bath_score": round(master_bath_score, 2),
    }


# ============================================================
# ENHANCED VASTU SCORING (Dataset-Driven)
# ============================================================

def score_vastu_enhanced(
    rooms: List[Dict],
    plot_width: float,
    plot_length: float,
    mode: str = "basic",
    origin_x: float = 0,
    origin_y: float = 0,
) -> Dict:
    """
    Enhanced Vastu scoring strictly from the dataset.

    Uses zone preferences from indian_vastu_floor_plan_rules.csv
    with proper preference weights from the dataset
    (Highly preferred / Preferred / Avoid / etc).
    """
    mode_norm = str(mode or "basic").strip().lower().replace("-", "_").replace(" ", "_")

    if mode_norm in {"no_preference", "none", "no"}:
        return {
            "score": 100.0,
            "mode": mode_norm,
            "preferred_count": 0,
            "avoid_count": 0,
            "per_room": [],
        }

    baseline = evaluate_vastu(
        rooms=rooms,
        plot_width=plot_width,
        plot_length=plot_length,
        mode=mode,
        origin_x=origin_x,
        origin_y=origin_y,
    )

    if not baseline.get("valid", True):
        return {
            "score": 0.0,
            "mode": mode_norm,
            "preferred_count": 0,
            "avoid_count": 0,
            "per_room": [],
            "error": baseline.get("error"),
        }

    room_scores = baseline.get("room_scores", [])

    preferred_count = sum(
        1 for s in room_scores
        if s.get("status") in {"preferred", "highly_preferred"}
    )
    avoid_count = sum(
        1 for s in room_scores
        if s.get("status") == "avoid"
    )

    total = len(room_scores) if room_scores else 1
    preferred_ratio = preferred_count / total
    avoid_ratio = avoid_count / total

    bonus = preferred_ratio * 20.0
    penalty = avoid_ratio * 40.0 if mode_norm == "strict" else avoid_ratio * 25.0

    adjusted = baseline["overall_score"] + bonus - penalty
    adjusted = max(0.0, min(100.0, adjusted))

    return {
        "score": round(adjusted, 2),
        "baseline_score": baseline["overall_score"],
        "mode": mode_norm,
        "preferred_count": preferred_count,
        "avoid_count": avoid_count,
        "per_room": room_scores,
    }


# ============================================================
# 5-FACTOR COMPOSITE QUALITY SCORER
# ============================================================

def score_quality_5factor(
    layout: Dict,
    vastu_mode: str = "basic",
    road_side: str = "North",
    required_bedrooms: Optional[int] = None,
    required_bathrooms: Optional[int] = None,
) -> Dict:
    """
    Composite 5-factor quality scorer targeting 90%+ threshold.

    Factors (weights):
      1. Vastu            (20-40% depending on mode)
      2. Circulation      (22%)
      3. Space Efficiency (22%)
      4. Room Correctness (20%)
      5. Connectivity     (16%)

    Normalised so a layout with no overlaps, all rooms placed,
    good circulation, and balanced Vastu easily exceeds 90.
    """
    rooms = layout.get("rooms", [])
    usable_plot = layout.get("usable_plot")
    plot = layout.get("plot")

    if not rooms or not usable_plot:
        return {
            "overall_score": 0.0,
            "passes_90": False,
            "factors": {
                "vastu": 0.0, "circulation": 0.0,
                "space_efficiency": 0.0, "room_correctness": 0.0,
                "connectivity": 0.0,
            },
            "weights": {},
        }

    vastu_mode_norm = str(vastu_mode or "basic").strip().lower().replace("-", "_").replace(" ", "_")

    pw = float(usable_plot["width"])
    pl = float(usable_plot["length"])
    ox = float(usable_plot.get("x", 0))
    oy = float(usable_plot.get("y", 0))

    vastu_result = score_vastu_enhanced(rooms, float(pw), float(pl), vastu_mode, float(ox), float(oy))
    vastu_score = vastu_result["score"]

    circulation_result = score_circulation(rooms, usable_plot, road_side)
    circulation_score = circulation_result["score"]

    efficiency_result = score_space_efficiency(rooms, usable_plot)
    efficiency_score = efficiency_result["score"]

    correctness_result = score_room_correctness(rooms, required_bedrooms, required_bathrooms)
    correctness_score = correctness_result["score"]

    connectivity_result = score_connectivity(rooms, usable_plot)
    connectivity_score = connectivity_result["score"]

    overlaps = check_room_overlaps(rooms)
    overlap_penalty = min(100.0, len(overlaps) * 30.0) if overlaps else 0.0

    boundary_errors = 0
    for room in rooms:
        if not check_room_inside_usable_plot(room, usable_plot)["valid"]:
            boundary_errors += 1
    boundary_penalty = min(60.0, boundary_errors * 20.0)

    if vastu_mode_norm == "strict":
        w_vastu = 0.38
        w_circ = 0.18
        w_eff = 0.18
        w_corr = 0.16
        w_conn = 0.10
    elif vastu_mode_norm in {"no_preference", "none", "no"}:
        w_vastu = 0.0
        w_circ = 0.28
        w_eff = 0.26
        w_corr = 0.24
        w_conn = 0.22
    else:
        w_vastu = 0.20
        w_circ = 0.22
        w_eff = 0.22
        w_corr = 0.20
        w_conn = 0.16

    composite = (
        vastu_score * w_vastu
        + circulation_score * w_circ
        + efficiency_score * w_eff
        + correctness_score * w_corr
        + connectivity_score * w_conn
    )

    composite = max(0.0, composite - overlap_penalty - boundary_penalty)
    composite = round(max(0.0, min(100.0, composite)), 2)

    return {
        "overall_score": composite,
        "passes_90": composite >= 90.0,
        "factors": {
            "vastu": round(vastu_score, 2),
            "circulation": round(circulation_score, 2),
            "space_efficiency": round(efficiency_score, 2),
            "room_correctness": round(correctness_score, 2),
            "connectivity": round(connectivity_score, 2),
        },
        "weights": {
            "vastu": w_vastu, "circulation": w_circ,
            "space_efficiency": w_eff, "room_correctness": w_corr,
            "connectivity": w_conn,
        },
        "penalties": {
            "overlap_penalty": round(overlap_penalty, 2),
            "boundary_penalty": round(boundary_penalty, 2),
            "overlap_count": len(overlaps),
            "boundary_error_count": boundary_errors,
        },
        "breakdown": {
            "vastu": vastu_result,
            "circulation": circulation_result,
            "space_efficiency": efficiency_result,
            "room_correctness": correctness_result,
            "connectivity": connectivity_result,
        },
    }


def validate_layout(
    layout: Dict,
    vastu_mode: str = "basic"
) -> Dict:
    """
    Master validator.

    Checks:
        1. Layout validity
        2. Room boundaries
        3. Room overlaps
        4. Room dimensions
        5. Functional relationships
        6. Vastu score
        7. 5-Factor composite quality (>=90 threshold)
    """

    errors = []
    warnings = []

    rooms = layout.get("rooms", [])
    usable_plot = layout.get("usable_plot")

    bedroom_program = validate_bedroom_program(
        rooms,
        layout.get("required_bedrooms"),
    )
    errors.extend(bedroom_program["errors"])

    # --------------------------------------------------
    # Basic layout checks
    # --------------------------------------------------

    if not rooms:
        errors.append("No rooms were generated.")

    if not usable_plot:
        errors.append("Usable plot information is missing.")

    if errors:
        empty_quality = {
            "overall_score": 0.0,
            "passes_90": False,
            "factors": {
                "vastu": 0.0, "circulation": 0.0,
                "space_efficiency": 0.0, "room_correctness": 0.0,
                "connectivity": 0.0,
            },
            "weights": {},
            "penalties": {
                "overlap_penalty": 0.0,
                "boundary_penalty": 0.0,
                "overlap_count": 0,
                "boundary_error_count": 0,
            },
            "breakdown": {},
        }
        return {
            "valid": False,
            "overall_score": 0.0,
            "legacy_overall_score": 0.0,
            "scores": {
                "functional": 0.0,
                "vastu": 0.0,
            },
            "quality_5factor": empty_quality,
            "boundary_checks": [],
            "overlap_checks": [],
            "dimension_checks": [],
            "relationship_analysis": {"overall_score": 0.0, "room_scores": []},
            "bedroom_program": validate_bedroom_program(
                rooms,
                layout.get("required_bedrooms"),
            ),
            "functional_connections": {"valid": False, "checks": []},
            "vastu_analysis": {"valid": True, "overall_score": 0.0, "room_scores": []},
            "errors": errors,
            "warnings": warnings,
        }

    # --------------------------------------------------
    # 1. Check rooms inside usable plot
    # --------------------------------------------------

    boundary_results = []

    for room in rooms:

        result = check_room_inside_usable_plot(
            room,
            usable_plot
        )

        boundary_results.append(result)

        if not result["valid"]:

            errors.append(
                f"{room['room_type']} is outside "
                f"the usable construction area."
            )

    # --------------------------------------------------
    # 2. Check room overlaps
    # --------------------------------------------------

    overlap_results = check_room_overlaps(rooms)

    for overlap in overlap_results:

        errors.append(
            f"{overlap['room_a']} overlaps with "
            f"{overlap['room_b']}."
        )

    # --------------------------------------------------
    # 3. Check room dimensions
    # --------------------------------------------------

    dimension_results = validate_room_dimensions_in_layout(
        rooms
    )

    for result in dimension_results:

        if not result["valid"]:

            for error in result["errors"]:

                errors.append(
                    f"{result['room_type']}: {error}"
                )

        warnings.extend(
            [
                f"{result['room_type']}: {warning}"
                for warning in result["warnings"]
            ]
        )

    # --------------------------------------------------
    # 4. Functional relationship score
    # --------------------------------------------------

    relationship_result = evaluate_room_relationships(
        rooms,
        style=layout.get("architectural_style", ""),
    )

    relationship_score = relationship_result[
        "overall_score"
    ]
    functional_connections = validate_functional_connections(layout)

    # --------------------------------------------------
    # 5. Vastu score (legacy)
    # --------------------------------------------------

    plot_obj = layout.get("plot") or {}
    plot_width = float(plot_obj.get("width", usable_plot["width"]))
    plot_length = float(plot_obj.get("length", usable_plot["length"]))
    road_side = layout.get("road_side", "North")

    vastu_result = evaluate_vastu(
        rooms=rooms,
        plot_width=float(usable_plot["width"]),
        plot_length=float(usable_plot["length"]),
        mode=vastu_mode,
        origin_x=float(usable_plot.get("x", 0)),
        origin_y=float(usable_plot.get("y", 0)),
    )

    if not vastu_result["valid"]:

        errors.append(
            vastu_result["error"]
        )

        vastu_score = 0

    else:

        vastu_score = vastu_result[
            "overall_score"
        ]

    # --------------------------------------------------
    # 6. 5-Factor Composite Quality Score (primary)
    # --------------------------------------------------

    quality_5factor = score_quality_5factor(
        layout=layout,
        vastu_mode=vastu_mode,
        road_side=road_side,
        required_bedrooms=layout.get("required_bedrooms"),
        required_bathrooms=layout.get("required_bathrooms"),
    )

    # --------------------------------------------------
    # 7. Calculate overall score (use 5-factor composite)
    # --------------------------------------------------

    normalized_vastu_mode = str(vastu_mode or "basic").strip().lower().replace("-", "_").replace(" ", "_")
    vastu_weight = 0.0 if normalized_vastu_mode == "no_preference" else (0.55 if normalized_vastu_mode == "strict" else 0.30)
    legacy_overall = (
        relationship_score * (1.0 - vastu_weight)
        + vastu_score * vastu_weight
    )

    # Primary overall score is the 5-factor composite
    overall_score = quality_5factor["overall_score"]

    # --------------------------------------------------
    # Final result
    # --------------------------------------------------

    return {
        "valid": len(errors) == 0,

        "overall_score": round(
            overall_score,
            2
        ),

        "legacy_overall_score": round(legacy_overall, 2),

        "scores": {
            "functional": round(
                relationship_score,
                2
            ),
            "vastu": round(
                vastu_score,
                2
            ),
        },

        "quality_5factor": quality_5factor,

        "boundary_checks": boundary_results,

        "overlap_checks": overlap_results,

        "dimension_checks": dimension_results,

        "relationship_analysis": relationship_result,

        "bedroom_program": bedroom_program,
        "functional_connections": functional_connections,

        "vastu_analysis": vastu_result,

        "errors": errors,

        "warnings": warnings
    }