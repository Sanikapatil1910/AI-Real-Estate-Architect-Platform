"""Constraint diagnostic and approval-based adjustment proposals.

When the exact brief cannot be planned the user is told *which* constraint failed (or that the search was inconclusive), with the real numbers:
the buildable footprint after the setbacks, what each floor needs, the parking bay and the stair.  Nothing here changes a brief: proposals are
only a list of specific changes, each with a reason, that the user may approve; `apply_adjustments` applies exactly the approved ones.

Vocabulary (`outcome`):
  exact              every requirement met                                           (a plan set is returned)
  mandatory_only     every MANDATORY requirement met, some PREFERENCES changed with the user's approval (plans returned, deviations listed)
  needs_approval     the exact brief was not planned, but changing only a PREFERENCE would work: the change is proposed, not applied
  infeasible         the area / dimension analysis proves the brief cannot fit (the failing constraint is named)
  inconclusive       the analysis says it can fit, but the layout search did not find an arrangement within the search performed (NOT a proof)
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional

from backend.planner.architect.feasibility import _site_and_program, analyse, available_box, check_request
from backend.planner.architect.rules import CAR_BAY_L, CAR_BAY_W, PARK_MIN_DEPTH, park_width

# What may never be changed without an explicit decision of the user.
MANDATORY = ("plot boundary and setbacks", "floor count", "room counts (bedrooms, bathrooms, kitchen, living ...)", "attached / common bathroom split",
             "minimum room dimensions", "parking bay (9 x 15 ft per car) with a road entrance", "stair and safe indoor circulation", "valid geometry")

# Preferences the planner may trade away -- each only with approval, each with the exact change it makes.
ADJUSTABLE = {
    "garden_off": {"field": "garden_required", "label": "Skip the front / rear garden strip",
                   "reason": "A garden keeps an 8 ft deep strip of the plot free of building; skipping it gives the rooms that depth."},
    "balcony_off": {"field": "balcony_required", "label": "Skip the upper-floor balcony",
                    "reason": "The balcony must run along an outer wall of a bedroom or lounge and takes floor area and a structural slot on the upper floor."},
    "vastu_basic": {"field": "vastu_mode", "label": "Use Basic instead of Strict Vastu placement",
                    "reason": "Strict Vastu fixes the zone of each room; Basic only favours it, which leaves the layout more freedom."},
    "ventilation_balanced": {"field": "ventilation", "label": "Use balanced ventilation instead of cross ventilation",
                             "reason": "Cross ventilation asks for open walls between the puja, the dining and the living spaces."},
    "puja_open": {"field": "puja_style", "label": "Make the puja an open alcove instead of a closed room",
                  "reason": "An open puja needs no walls and no door of its own."},
}


def _setbacks(payload) -> Dict[str, float]:
    sb = payload.get("setbacks") or {}
    return {k: float(sb.get(k, 0) or 0) for k in ("front", "rear", "left", "right")}


def _applies(pid: str, payload: Dict[str, Any]) -> bool:
    f = ADJUSTABLE[pid]["field"]
    v = payload.get(f)
    if pid == "garden_off":
        return bool(v)
    if pid == "balcony_off":
        return bool(v)
    if pid == "vastu_basic":
        return str(v or "").lower() == "strict"
    if pid == "ventilation_balanced":
        return str(v or "").lower() in ("cross ventilation", "high")
    if pid == "puja_open":
        return False                                     # open puja is already the permissive choice; closed is a deliberate preference we do not trade
    return False


def apply_adjustments(payload: Dict[str, Any], approved: List[str]) -> tuple:
    """Apply exactly the approved adjustments.  Returns (new payload, [applied records]).  Unknown ids are ignored, never guessed."""
    p = deepcopy(payload)
    applied = []
    for pid in approved or []:
        meta = ADJUSTABLE.get(pid)
        if not meta or not _applies(pid, payload):
            continue
        f = meta["field"]
        before = payload.get(f)
        after = {"garden_required": False, "balcony_required": False, "vastu_mode": "basic", "ventilation": "Balanced", "puja_style": "open"}[f]
        p[f] = after
        applied.append({"id": pid, "label": meta["label"], "reason": meta["reason"], "field": f, "from": before, "to": after})
    p["approved_adjustments"] = [a["id"] for a in applied]
    return p, applied


def _floor_rows(rep: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [{"floor": f["floor"], "rooms": f["rooms"], "min_area_needed": f["min_area_needed"], "practical_area_needed": f["practical_area_needed"],
             "comfortable_area_needed": f["comfortable_area_needed"], "buildable_area": f["buildable_area"], "status": f["status"]}
            for f in rep.get("floors", [])]


def diagnose(payload: Dict[str, Any], verdict: str = "unknown", attempts: Optional[List[Dict[str, Any]]] = None,
             conflicts: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Transparent report of the constraints of a brief on its plot (no layout is built).  `verdict` is what the search concluded
    ('infeasible' | 'inconclusive' | 'feasible' | 'unknown')."""
    from backend.planner.architect.spec import normalise_site
    out: Dict[str, Any] = {"verdict": verdict, "mandatory": list(MANDATORY)}
    try:
        p = normalise_site(payload)
        site, program = _site_and_program(p)
    except (KeyError, ValueError, TypeError) as exc:
        return {"verdict": "invalid", "error": str(exc), "mandatory": list(MANDATORY)}
    sb = _setbacks(p)
    box = available_box(site)
    rep = analyse(site, program)
    nfl = len(program.floors)
    cap = box["frontage"] * box["depth"]
    notes: List[str] = []
    # ---- geometry: one consistent frontage / depth / setback picture ---------------------------------------------------------------------
    entered = p.get("entered_plot") or [p["plot_width"], p["plot_length"]]
    if p.get("frontage_selected"):
        notes.append(f"Frontage {p['plot_frontage']:g} ft faces the {p.get('road_side', 'North')} road; depth is {p['plot_depth']:g} ft "
                     f"(you entered {entered[0]:g} x {entered[1]:g} ft).")
    else:
        notes.append(f"No frontage was chosen: the {p.get('road_side', 'North')} road decides it ({p['plot_frontage']:g} ft frontage, {p['plot_depth']:g} ft depth).")
    # setbacks on the frontage axis are left / right for a N/S road, and front / rear along the depth: the side setbacks come off the frontage
    out["geometry"] = {
        "entered_plot_ft": [float(entered[0]), float(entered[1])],
        "frontage_ft": float(p["plot_frontage"]), "depth_ft": float(p["plot_depth"]), "road_side": p.get("road_side", "North"),
        "setbacks_ft": sb,
        "usable_frontage_ft": round(site.usable_frontage, 1), "usable_depth_ft": round(site.usable_depth, 1),
        "usable_area_sqft": round(site.usable_frontage * site.usable_depth),
        "garden_strip_depth_ft": box["yard_depth"],
        "buildable_frontage_ft": round(box["frontage"], 1), "buildable_depth_ft": round(box["depth"], 1),
        "ground_footprint_capacity_sqft": round(cap),
        "floors": nfl,
        "stacked_floor_area_capacity_sqft": round(cap * nfl),           # all floors together: NOT added to the footprint capacity above
        "notes": notes,
    }
    # ---- area, per floor (the floors share one footprint, so each is judged against the footprint, never against the sum) -----------------
    rows = _floor_rows(rep)
    out["floors"] = rows
    out["area_summary"] = {
        "ground_floor_footprint_capacity_sqft": round(cap),
        "required_by_floor_sqft": {r["floor"]: {"minimum": r["min_area_needed"], "practical": r["practical_area_needed"],
                                                 "comfortable": r["comfortable_area_needed"]} for r in rows},
        "total_required_all_floors_minimum_sqft": sum(r["min_area_needed"] for r in rows),
        "total_capacity_all_floors_sqft": round(cap * nfl),
        "note": "Each floor is checked against the one shared footprint; the area of an upper floor is never counted as ground-floor area.",
    }
    # ---- parking -------------------------------------------------------------------------------------------------------------------------
    park = None
    if site.cars or site.bikes:
        specs = [s for s in program.floors[0].specs if s.type in ("parking", "bike_parking")]
        pw = max((park_width(s.type, s.role) for s in specs), default=0.0)
        pd = max((PARK_MIN_DEPTH[s.type] for s in specs), default=0.0)
        stair_short = program.stair_dims[0] if program.stair_dims else 0.0
        need_front = pw + 6.0
        park = {"cars": site.cars, "bikes": site.bikes, "bay_ft": [CAR_BAY_W, CAR_BAY_L], "porch_width_ft": round(pw, 1), "min_depth_ft": pd,
                "fits_depth": box["depth"] >= pd - 1e-6, "fits_frontage": box["frontage"] >= need_front,
                "min_frontage_with_entrance_ft": round(need_front, 1),
                "position": "covered porch on the road side, inside the ground-floor footprint; its position along the frontage (left / right of the "
                            "entrance hall) is searched; it never blocks the entrance, the stair or the passage",
                "reduced_to_pass": False}
        if not park["fits_depth"]:
            pass
    out["parking"] = park
    out["circulation"] = {"stair_ft": list(program.stair_dims) if program.stair_dims else None, "stair_on_every_floor": nfl > 1,
                          "rule": "every room is reached indoors through a hall, lobby or passage, never through a bedroom or across a terrace"}
    # ---- which mandatory constraint fails, if any -------------------------------------------------------------------------------------------
    failed: List[Dict[str, Any]] = []
    for r in rows:
        if r["status"] == "infeasible":
            failed.append({"constraint": "floor area", "floor": r["floor"],
                           "detail": f"{r['floor']} needs at least {r['min_area_needed']} sq ft (every room at its minimum, the stair and the car porch at their real "
                                     f"size) but the buildable footprint is {r['buildable_area']} sq ft."})
    for e in rep.get("reasons", []):
        if not any(e == f["detail"] for f in failed):
            failed.append({"constraint": "geometry", "detail": e})
    if park and not park["fits_depth"]:
        failed.append({"constraint": "parking", "detail": f"The parking bay needs {park['min_depth_ft']:g} ft of depth; only {box['depth']:.1f} ft remain after the setbacks."})
    if park and not park["fits_frontage"]:
        failed.append({"constraint": "parking", "detail": f"The parking porch is {park['porch_width_ft']:g} ft wide and the entrance needs about 6 ft more; "
                                                           f"only {box['frontage']:.1f} ft of frontage remain after the setbacks."})
    out["failed_mandatory"] = failed
    out["tight_floors"] = [r["floor"] for r in rows if r["status"] in ("tight", "very_tight")]
    # ---- adjustable preferences that are set in this brief ----------------------------------------------------------------------------------
    out["adjustable_preferences"] = [{"id": pid, "label": m["label"], "reason": m["reason"], "current": p.get(m["field"])}
                                     for pid, m in ADJUSTABLE.items() if _applies(pid, p)]
    out["courtyard_note"] = "A courtyard preference is a planning wish only: it does not take extra area away from the rooms."
    # a failure that disappears when only a PREFERENCE is changed is a conflict with that preference, not an impossible brief: it needs approval
    blocked: List[str] = []
    if rep["status"] == "infeasible":
        for item in out["adjustable_preferences"]:
            q, _ = apply_adjustments(p, [item["id"]])
            if check_request(q, suggest=False)["status"] not in ("infeasible", "invalid"):
                blocked.append(item["id"])
    out["blocked_by_preferences"] = blocked
    out["attempts"] = _summarise_attempts(attempts or [])
    out["conflicts"] = list(conflicts or [])
    if verdict == "unknown":
        out["verdict"] = "infeasible" if failed else "feasible"
    out["outcome"] = "needs_approval" if (blocked and out["verdict"] == "infeasible") else out["verdict"]
    out["summary"] = _summary(out)
    return out


def _summarise_attempts(attempts: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not attempts:
        return {"count": 0, "log": []}
    return {"count": len(attempts), "seconds": round(sum(a.get("seconds", 0) for a in attempts), 1),
            "strategies": sorted({a["strategy"] for a in attempts}), "log": attempts}


def _summary(d: Dict[str, Any]) -> str:
    g = d["geometry"]
    head = (f"Buildable footprint {g['buildable_frontage_ft']:g} x {g['buildable_depth_ft']:g} ft = {g['ground_footprint_capacity_sqft']} sq ft "
            f"after setbacks{' and the garden strip' if g['garden_strip_depth_ft'] else ''}.")
    if d.get("blocked_by_preferences") and d["verdict"] == "infeasible":
        labels = [a["label"] for a in d["adjustable_preferences"] if a["id"] in d["blocked_by_preferences"]]
        return head + (" A preference you set is what stops the brief fitting; changing only that would work (needs your approval): " + "; ".join(labels) + ".")
    if d["failed_mandatory"]:
        return head + " Mandatory constraint failed: " + " ".join(f["detail"] for f in d["failed_mandatory"][:2])
    if d["verdict"] == "inconclusive":
        n = d["attempts"]["count"]
        return head + f" No mandatory constraint is violated by the area analysis; the layout search found no arrangement in {n} attempts (not a proof of impossibility)."
    return head + " No mandatory constraint is violated by the area analysis."


# --------------------------------------------------------------------------------------------------------------------------------------------
def propose_adjustments(payload: Dict[str, Any], verify: bool = True, verify_budget_s: float = 12.0, max_total_s: float = 70.0,
                        seed: Optional[int] = None) -> Dict[str, Any]:
    """Specific changes the user may approve, cheapest first.  Preference-level changes are VERIFIED (a layout is searched with the change applied
    when `verify`); changes to the brief itself (parking, floors, rooms) are listed separately as decisions only the user can take, and are never
    part of an approval of preferences."""
    import time
    from backend.planner.architect import service
    from backend.planner.architect.spec import normalise_site
    t0 = time.time()
    p = normalise_site(payload)
    p["strict"] = True
    pref_ids = [pid for pid in ADJUSTABLE if _applies(pid, p)]
    proposals: List[Dict[str, Any]] = []
    chosen: List[str] = []
    verified_with: Optional[List[str]] = None
    for pid in pref_ids:
        chosen = chosen + [pid]
        q, applied = apply_adjustments(p, chosen)
        static = check_request(q, suggest=False)
        entry = {"id": pid, "kind": "preference", **{k: ADJUSTABLE[pid][k] for k in ("label", "reason")}, "field": ADJUSTABLE[pid]["field"],
                 "from": p.get(ADJUSTABLE[pid]["field"]), "to": applied[-1]["to"] if applied else None,
                 "static_status": static["status"], "verified": None}
        proposals.append(entry)
        if static["status"] in ("infeasible", "invalid"):
            continue
        if not verify:
            continue
        if time.time() - t0 > max_total_s:
            break
        try:
            res = service.generate(dict(q, closest_if_infeasible=False), budget_s=verify_budget_s, seed=seed, max_total_s=max_total_s)
            ok = bool(res.get("plans"))
        except (service.NoLayout, service.Infeasible):
            ok = False
        entry["verified"] = ok
        if ok:
            verified_with = list(chosen)
            break
    # the decisions that change the brief itself (mandatory): offered, never applied by an approval of preferences
    decisions = []
    for s in check_request(p, suggest=True).get("suggestions", []):
        decisions.append({"kind": "mandatory_change", "label": s["change"], "patch": s["patch"], "needs_explicit_decision": True})
    status = "preference_change_works" if verified_with else ("no_preference_change_found" if pref_ids else "no_adjustable_preference")
    return {"status": status, "recommended": verified_with or [], "proposals": proposals, "mandatory_decisions": decisions,
            "note": "Nothing is applied until you approve it. Floor count, room counts, parking and the plot are never changed by approving preferences.",
            "elapsed_s": round(time.time() - t0, 1)}
