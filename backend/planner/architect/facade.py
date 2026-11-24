"""Facade rules applied centrally to every plan: the chajja (sun-shade slab) over EVERY window of EVERY floor.

The 3D builder and the 2D drawing both read the `chajja` record carried by each window, so nothing is invented by a renderer and a window
cannot be left without one.  Projection and thickness are configurable per request (`chajja_projection_ft`, `chajja_thickness_ft`).
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from backend.planner.architect import rules


def chajja_spec(payload: Dict[str, Any] | None = None) -> Dict[str, float]:
    """Projection / thickness / side overhang in feet, from the request when given (clamped to a sane range), else the defaults."""
    payload = payload or {}
    lim = rules.CHAJJA_LIMITS

    def pick(key: str, default: float, lo_hi: Tuple[float, float]) -> float:
        try:
            v = float(payload.get(key))
        except (TypeError, ValueError):
            return default
        return round(min(max(v, lo_hi[0]), lo_hi[1]), 3)

    return {
        "projection": pick("chajja_projection_ft", rules.CHAJJA_PROJECTION_FT, lim["projection"]),
        "thickness": pick("chajja_thickness_ft", rules.CHAJJA_THICKNESS_FT, lim["thickness"]),
        "overhang": rules.CHAJJA_SIDE_OVERHANG_FT,
    }


def apply_chajjas(plan: Dict[str, Any], payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Give every window of every floor its chajja record (same wall, same width + overhang, above the lintel).  Idempotent."""
    spec = chajja_spec(payload)
    plan["chajja_spec"] = dict(spec)
    for fl in plan.get("floors", []):
        lay = fl.get("layout", {})
        for w in (lay.get("openings") or {}).get("windows", []):
            w["chajja"] = {
                "wall": w["wall"], "room": w["room"], "position": w["position"], "width": round(float(w["width"]) + 2 * spec["overhang"], 2),
                "projection": spec["projection"], "thickness": spec["thickness"], "overhang": spec["overhang"],
            }
    return plan


def chajja_problems(plan: Dict[str, Any]) -> List[Tuple[str, str]]:
    """(floor name, message) for every window that lacks a correct chajja: absent, on another wall, not covering the window, or with a
    projection / thickness different from the plan's configured values."""
    out: List[Tuple[str, str]] = []
    spec = plan.get("chajja_spec")
    for fl in plan.get("floors", []):
        for i, w in enumerate((fl.get("layout", {}).get("openings") or {}).get("windows", [])):
            c = w.get("chajja")
            where = f"{w.get('room')} / {w.get('wall')} wall"
            if not spec:
                out.append((fl["floor"], f"no chajja specification on the plan ({where})")); continue
            if not c:
                out.append((fl["floor"], f"window {i + 1} of {where} has no chajja")); continue
            if c.get("wall") != w["wall"] or c.get("room") != w["room"]:
                out.append((fl["floor"], f"chajja of {where} is on the wrong wall"))
            elif c.get("width", 0) + 1e-6 < float(w["width"]):
                out.append((fl["floor"], f"chajja of {where} is narrower than the window"))
            elif abs(c.get("projection", 0) - spec["projection"]) > 1e-6 or abs(c.get("thickness", 0) - spec["thickness"]) > 1e-6:
                out.append((fl["floor"], f"chajja of {where} differs from the configured projection / thickness"))
    return out


# ---------------------------------------------------------------------------------------------------------------------------------
# Envelope: roof overhang and balcony projection.  Both are decided here (once, from the plan and the request) and drawn by the 3D
# builder from the records; the enclosed floor area, the balcony area and the plot / setback area stay separate quantities.
# ---------------------------------------------------------------------------------------------------------------------------------
_SIDES = ("top", "bottom", "left", "right")


def _floor_down(x: float, g: float = 0.25) -> float:
    return int(x / g + 1e-9) * g


def _pick(payload: Dict[str, Any] | None, key: str, default: float, lo_hi: Tuple[float, float]) -> float:
    try:
        v = float((payload or {}).get(key))
    except (TypeError, ValueError):
        return default
    return round(min(max(v, lo_hi[0]), lo_hi[1]), 3)


def _footprint(plan: Dict[str, Any]) -> Tuple[float, float, float, float]:
    xs0, ys0, xs1, ys1 = [], [], [], []
    for fl in plan.get("floors", []):
        for r in fl.get("layout", {}).get("rooms", []):
            xs0.append(r["x"]); ys0.append(r["y"]); xs1.append(r["x2"]); ys1.append(r["y2"])
    return (min(xs0), min(ys0), max(xs1), max(ys1)) if xs0 else (0.0, 0.0, 0.0, 0.0)


def _margins(plan: Dict[str, Any]) -> Dict[str, float]:
    """Open ground between the building footprint and the plot boundary on each side (the setback area)."""
    bx0, by0, bx1, by1 = _footprint(plan)
    plot = (plan["floors"][0].get("layout", {}) or {}).get("plot") or {}
    px, py = float(plot.get("x", 0.0)), float(plot.get("y", 0.0))
    pw, pl = float(plot.get("width", bx1)), float(plot.get("length", by1))
    return {"top": by0 - py, "bottom": py + pl - by1, "left": bx0 - px, "right": px + pw - bx1}


def roof_spec(plan: Dict[str, Any], payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Roof overhang: requested value (clamped) and how much of it each side can really have (never within ROOF_PLOT_CLEAR_FT of the plot edge)."""
    want = _pick(payload, "roof_overhang_ft", rules.ROOF_OVERHANG_FT, rules.ROOF_OVERHANG_LIMITS)
    m = _margins(plan)
    by_side = {s: round(max(0.0, min(want, _floor_down(m[s] - rules.ROOF_PLOT_CLEAR_FT))), 3) for s in _SIDES}
    return {"overhang_ft": want, "limits": list(rules.ROOF_OVERHANG_LIMITS), "plot_clear_ft": rules.ROOF_PLOT_CLEAR_FT, "by_side": by_side}


def _blocked_by_entrance(plan: Dict[str, Any], side: str, line: float, a: float, b: float) -> bool:
    """Is the ground floor below a balcony edge the main entrance or a car porch?  (Then the balcony does not project over it.)"""
    g = plan["floors"][0].get("layout", {})
    clr = rules.BALCONY_PORCH_CLEAR_FT
    horiz = side in ("top", "bottom")
    for r in g.get("rooms", []):
        if r["room_type"] not in ("parking", "bike_parking"):
            continue
        lo, hi = (r["x"], r["x2"]) if horiz else (r["y"], r["y2"])
        edge_lo, edge_hi = (r["y"], r["y2"]) if horiz else (r["x"], r["x2"])
        if hi > a - clr and lo < b + clr and edge_lo - 1.0 <= line <= edge_hi + 1.0:
            return True
    for d in (g.get("openings") or {}).get("doors", []):
        if d.get("door_type") != "main" or any(d.get(k) is None for k in ("x1", "y1", "x2", "y2")):
            continue
        if horiz and abs(d["y1"] - d["y2"]) < 0.05 and abs(d["y1"] - line) < 0.6:
            if max(d["x1"], d["x2"]) > a - clr and min(d["x1"], d["x2"]) < b + clr:
                return True
        if not horiz and abs(d["x1"] - d["x2"]) < 0.05 and abs(d["x1"] - line) < 0.6:
            if max(d["y1"], d["y2"]) > a - clr and min(d["y1"], d["y2"]) < b + clr:
                return True
    return False


def apply_envelope(plan: Dict[str, Any], payload: Dict[str, Any] | None = None, projections: bool = True) -> Dict[str, Any]:
    """Attach the roof-overhang spec and (generated plans only) the balcony projections.  Idempotent.

    A balcony on an upper floor may cantilever beyond the enclosed floor on the sides that face the open ground.  The enclosed rooms stay
    inside the usable plot; the projection only uses what is left of the setback, never closer than BALCONY_PLOT_CLEAR_FT to the plot edge,
    never over the main entrance or a car porch, and never overlapping another projection.  The record is `layout["balcony_projections"]`.
    """
    if not plan.get("floors"):
        return plan
    plan["roof_spec"] = roof_spec(plan, payload)
    for fl in plan["floors"]:
        fl.setdefault("layout", {}).pop("balcony_projections", None)
    if not projections:
        return plan
    cfg = _pick(payload, "balcony_projection_ft", rules.BALCONY_PROJECTION_FT, rules.BALCONY_PROJECTION_LIMITS)
    bx0, by0, bx1, by1 = _footprint(plan)
    edge = {"top": by0, "bottom": by1, "left": bx0, "right": bx1}
    m = _margins(plan)
    allowed = {s: _floor_down(min(cfg, m[s] - rules.BALCONY_PLOT_CLEAR_FT)) for s in _SIDES}
    taken: List[Tuple[float, float, float, float, int]] = []          # projection rectangles already placed (x0, y0, x1, y1, floor)
    area_total = 0.0
    for fi, fl in enumerate(plan["floors"]):
        if fi == 0:
            continue
        lay = fl.setdefault("layout", {})
        recs = []
        for r in lay.get("rooms", []):
            if r["room_type"] != "balcony":
                continue
            sides: Dict[str, float] = {}
            for side in _SIDES:
                line = {"top": r["y"], "bottom": r["y2"], "left": r["x"], "right": r["x2"]}[side]
                if abs(line - edge[side]) > 0.01:
                    continue                                              # not an outer side of the building
                p = allowed[side]
                if p < rules.BALCONY_MIN_PROJECTION_FT - 1e-9:
                    continue
                a, b = (r["x"], r["x2"]) if side in ("top", "bottom") else (r["y"], r["y2"])
                if _blocked_by_entrance(plan, side, line, a, b):
                    continue
                sides[side] = p
            if not sides:
                continue
            rect_of = lambda s_, p_: ((r["x"], r["y"] - p_, r["x2"], r["y"]) if s_ == "top" else (r["x"], r["y2"], r["x2"], r["y2"] + p_) if s_ == "bottom"
                                      else (r["x"] - p_, r["y"], r["x"], r["y2"]) if s_ == "left" else (r["x2"], r["y"], r["x2"] + p_, r["y2"]))
            for s_ in list(sides):
                x0, y0, x1, y1 = rect_of(s_, sides[s_])
                if any(f_ == fi and not (x1 <= tx0 + 1e-6 or tx1 <= x0 + 1e-6 or y1 <= ty0 + 1e-6 or ty1 <= y0 + 1e-6) for tx0, ty0, tx1, ty1, f_ in taken):
                    del sides[s_]
                else:
                    taken.append((x0, y0, x1, y1, fi))
            if not sides:
                continue
            area = sum(((r["x2"] - r["x"]) if s_ in ("top", "bottom") else (r["y2"] - r["y"])) * p_ for s_, p_ in sides.items())
            for s_, p_ in sides.items():
                for o_, q_ in sides.items():
                    if s_ < o_ and ((s_ in ("top", "bottom")) != (o_ in ("top", "bottom"))):
                        area += p_ * q_                                   # corner square where two projected sides meet
            recs.append({"room": r.get("id") or r["room_type"], "sides": {k: round(v, 3) for k, v in sides.items()}, "area_ft2": round(area, 1)})
            area_total += area
        if recs:
            lay["balcony_projections"] = recs
    plan["balcony_spec"] = {"projection_ft": cfg, "limits": list(rules.BALCONY_PROJECTION_LIMITS), "plot_clear_ft": rules.BALCONY_PLOT_CLEAR_FT,
                            "allowed_by_side": {k: round(v, 3) for k, v in allowed.items()}, "projected_area_ft2": round(area_total, 1),
                            "note": "A cantilever beyond the enclosed floor, inside the setback area; check the local rule for projections into open margins."}
    return plan
