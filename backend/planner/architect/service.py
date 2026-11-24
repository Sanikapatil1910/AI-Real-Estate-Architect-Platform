"""Public entry point of the architect engine (used by the API)."""

from __future__ import annotations

import threading
import time
from typing import Any, Dict, List

from backend.planner.architect.adapter import plan_to_legacy
from backend.planner.architect.engine import pick_four, search
from backend.planner.architect.feasibility import check_request
from backend.planner.architect.rules import STRICT, set_aspect, set_compact, set_strict
from backend.planner.architect.verify import verify_plan

_LOCK = threading.RLock()


class NoLayout(Exception):
    """The brief passed the area check but no layout satisfying every rule was found."""
    def __init__(self, report: Dict[str, Any], message: str, conflicts: List[Dict[str, Any]] | None = None):
        super().__init__(message)
        self.report = report
        self.message = message
        self.conflicts = conflicts or []
        self.verdict = "inconclusive"        # 'infeasible' only when the area / dimension analysis proves it; a failed search proves nothing
        self.attempts: List[Dict[str, Any]] = []
        self.diagnostic: Dict[str, Any] = {}


class Infeasible(Exception):
    def __init__(self, report: Dict[str, Any]):
        super().__init__("The brief cannot be planned on this plot")
        self.report = report


def _normalise_vastu(mode: Any) -> str:
    m = str(mode or "no_preference").strip().lower().replace("-", "_").replace(" ", "_")
    if m in {"none", "no"}:
        return "no_preference"
    return m if m in {"no_preference", "basic", "strict"} else "basic"


def _legacy_extras(plan: Dict[str, Any], payload: Dict[str, Any]) -> None:
    """Cost / energy summaries from the existing estimators (best effort)."""
    try:
        from backend.planner.cost_estimator import estimate_cost
        plan["cost"] = estimate_cost(plan["floors"])
    except Exception:
        plan["cost"] = None
    try:
        from backend.planner.energy_analyzer import analyze_energy
        plan["energy"] = {
            f["floor"]: analyze_energy(f["layout"], road_side=plan["road_side"],
                                       climate=payload.get("climate", "Auto"))
            for f in plan["floors"] if f["layout"].get("rooms")
        }
    except Exception:
        plan["energy"] = {}


def _generate_once(payload: Dict[str, Any], budget_s: float = 14.0, seed: int | None = None) -> Dict[str, Any]:
    from backend.planner.architect.spec import normalise_site
    payload = normalise_site(payload)
    payload["rooms"] = [r if isinstance(r, dict) else {"room_type": str(r)} for r in payload.get("rooms", [])]
    payload["vastu_mode"] = _normalise_vastu(payload.get("vastu_mode"))
    report = check_request(payload, suggest=True)
    if report["status"] == "infeasible":
        raise Infeasible(report)
    t0 = time.time()
    verified: List[Dict[str, Any]] = []
    res = None
    attempt = 0
    last_failures: List[str] = []
    pool_all: List[Any] = []                                  # candidates of every attempt: a later attempt adds to the earlier ones
    failed: set = set()
    strip_tried = False
    from backend.planner.architect.circulation import analyse_building
    thin = False
    if payload.get("building_type", "Ground") != "Ground" and not payload.get("_algo"):
        try:
            from backend.planner.architect.feasibility import _site_and_program, available_box
            _s0, _p0 = _site_and_program(payload)
            _b0 = available_box(_s0)
            thin = _b0["depth"] <= 20.0 or _b0["frontage"] / max(_b0["depth"], 1.0) > 2.2
        except Exception:
            thin = False
    while attempt < 3:
        attempt += 1
        res = None
        if thin and not strip_tried:
            # long, shallow footprint: the corridor layout is quick when it works and is capped when it does not; the band engine comes second
            strip_tried = True
            alt = search(dict(payload, _algo="strip"), budget_s=min(1.2, budget_s * 0.3), seed=(seed if seed is not None else 7) + attempt * 211,
                         give_up=1.0)
            if alt.get("ok") and alt["plans"]:
                res = alt
        if res is None:
            res = search(payload, budget_s=budget_s * (0.6 if attempt == 1 else 0.4),
                         seed=(seed if seed is not None else 7) + attempt * 101,
                         give_up=float(payload.get("_giveup") or (0.2 if thin else (0.6 if payload.get("_relaxed") else 0.0))))
        if not res["ok"]:
            raise Infeasible(res["feasibility"])
        if not res["plans"] and res.get("stats", {}).get("floors_ok", 0) == 0 and not pool_all and not strip_tried and not payload.get("_algo") \
                and payload.get("building_type", "Ground") != "Ground":
            strip_tried = True
            alt = search(dict(payload, _algo="strip"), budget_s=min(3.5, budget_s * 0.35), seed=(seed if seed is not None else 7) + attempt * 211,
                         give_up=1.0)
            if alt.get("ok") and alt["plans"]:
                res = alt
        site = res["site"]
        pool_all.extend(res["plans"])
        if not res["plans"] and res.get("stats", {}).get("floors_ok", 0) == 0 and (payload.get("_relaxed") or attempt >= 2):
            break                                              # nothing valid for this brief: more seeds only burn time, the caller relaxes it
        for _round in range(4):                               # re-pick when a chosen candidate fails verification
            verified = []
            dropped = False
            for k, ps in enumerate(pick_four([c for c in pool_all if id(c) not in failed], 4), start=1):
                plan = plan_to_legacy(ps, k, site, res["yard"], payload["vastu_mode"], payload,
                                      {"parking": _parking(payload)})
                plan["site"] = {"frontage": payload["plot_frontage"], "depth": payload["plot_depth"], "road_side": site.road_side,
                                "frontage_selected": payload["frontage_selected"], "entered_plot": payload["entered_plot"],
                                "plot_width": site.plot_w, "plot_length": site.plot_l}
                from backend.planner.architect.facade import apply_chajjas, apply_envelope
                apply_chajjas(plan, payload)
                apply_envelope(plan, payload)
                v = verify_plan(plan, payload)
                plan["verification"] = v
                plan["circulation"] = analyse_building(plan)       # per-floor indoor circulation report (diagnostics if it ever fails)
                for fl_, rep_ in zip(plan["floors"], plan["circulation"]["floors"]):   # the floor's own flag says what the rules say
                    c_ = fl_["layout"]["openings"]["circulation"]
                    c_["connected"] = c_["valid"] = not rep_["issues"]
                    c_["indoor_connected"] = rep_["reachable_indoor"] == rep_["indoor_rooms"]
                    c_["errors"] = [i_["message"] for i_ in rep_["issues"]]
                if v["passed"]:
                    plan["passes_90_percent"] = True
                    verified.append(plan)
                else:
                    last_failures.extend(v["errors"][:3])
                    failed.add(id(ps))
                    dropped = True
            if len(verified) >= 4 or not dropped:
                break
        if len(verified) >= 4:
            break
    for i, p in enumerate(verified, start=1):
        p["plan_number"] = i
        _legacy_extras(p, payload)
    if not verified:
        import os
        if os.environ.get('ARCH_DEBUG'): print('VERIFY FAIL', last_failures[:8])
        why = ""
        seen = []
        for f_ in last_failures:                              # say what the rejected candidates broke (circulation rules read clearly)
            if f_ not in seen:
                seen.append(f_)
        if seen:
            why = " Candidates were rejected because: " + "; ".join(seen[:3]) + "."
        raise NoLayout(report, "No layout satisfying every architectural rule (including a valid indoor circulation: every room reached "
                               "through a corridor, lobby or common room, never across a terrace or through a bedroom) was found for "
                               "this brief and plot." + why + " Nothing was added or removed to force a plan; fewer rooms, a smaller parking, or a larger plot would help.",
                       conflicts=[{"code": "NO_LAYOUT", "message": m_} for m_ in seen[:5]])
    first = verified[0] if verified else None
    scores = [p["quality_score"] for p in verified] or [0]
    return {
        "engine": "architect",
        "building_type": payload.get("building_type", "Ground"),
        "parking": _parking(payload),
        "staircase_required": bool(first and first["staircase_required"]),
        "staircase": first["staircase"] if first else None,
        "total_plans": len(verified),
        "requested_plans": 4,
        "quality_threshold": 0,
        "quality_summary": {
            "all_pass": len(verified) == 4, "min_score": min(scores), "max_score": max(scores),
            "avg_score": round(sum(scores) / len(scores), 1),
            "plans_passing": len(verified), "plans_total": len(verified),
            "note": "Every returned plan passed the independent geometry/door/size verifier.",
        },
        "feasibility": report,
        "warnings": (res["program"].warnings if res else []),
        "regeneration_stats": [],
        "search": {"elapsed_s": round(time.time() - t0, 1), "attempts": attempt,
                   "candidates": len(pool_all), "rejected_examples": last_failures[:5],
                   "algorithms": sorted({getattr(c_, "family", "") for c_ in pool_all if getattr(c_, "family", "")})},
        "plans": verified,
    }


_PARKING_MIX = {"1 Car": (1, 0), "2 Cars": (2, 0), "Bikes": (0, 3), "Car + Bikes": (1, 2)}


def _parking(payload: Dict[str, Any]) -> Dict[str, Any]:
    from backend.planner.architect.site import PARKING_BAY_L, PARKING_BAY_W
    req = bool(payload.get("parking_required"))
    n = int(payload.get("parking_spaces", 1) or 1) if req else 0
    ptype = str(payload.get("parking_type") or "")
    cars, bikes = _PARKING_MIX.get(ptype, (n, 0)) if req else (0, 0)
    from backend.planner.architect.rules import CAR_BAY_L, CAR_BAY_W
    return {"required": req, "spaces": n, "width": PARKING_BAY_W, "length": PARKING_BAY_L,
            "bay_width": CAR_BAY_W, "min_length": CAR_BAY_L,
            "area": n * PARKING_BAY_W * PARKING_BAY_L, "type": ptype or (f"{n} Car" if n == 1 else f"{n} Cars" if n else ""),
            "cars": cars, "bikes": bikes}


# ---------------------------------------------------------------------------
# Relaxation ladder: the user always gets plans.
# ---------------------------------------------------------------------------
_OPTIONAL_1 = ("puja_room", "utility", "study", "family_lounge")


def _drop(payload: Dict[str, Any], types, keep_at_least: Dict[str, int] | None = None) -> List[str]:
    removed: List[str] = []
    out = []
    for r in payload["rooms"]:
        t = r.get("room_type")
        if t in types:
            removed.append(t)
        else:
            out.append(r)
    payload["rooms"] = out
    return removed


def _trim_bedrooms(payload: Dict[str, Any], keep: int) -> int:
    beds = [r for r in payload["rooms"] if r.get("room_type") in ("bedroom", "guest_bedroom")]
    cut = max(0, len(beds) - max(0, keep - 1))      # the master bedroom is always kept
    drop_ids = {id(r) for r in beds[::-1][:cut]}
    payload["rooms"] = [r for r in payload["rooms"] if id(r) not in drop_ids]
    # keep bathrooms in line with what is left
    n_beds = sum(1 for r in payload["rooms"] if r.get("room_type") in
                 ("master_bedroom", "bedroom", "guest_bedroom"))
    baths = [r for r in payload["rooms"] if r.get("room_type") == "bathroom"]
    extra = max(0, len(baths) - (n_beds + 1))
    if extra:
        drop2 = {id(r) for r in baths[::-1][:extra]}
        payload["rooms"] = [r for r in payload["rooms"] if id(r) not in drop2]
    return cut


PARKING_DROPPED_NOTE = ("The car parking could not be fitted on this plot together with the rooms and the number of floors you asked for, "
                        "even with compact rooms, so it was left out as a last resort. Park on the street, or choose a larger plot / "
                        "another floor count yourself to keep the parking.")


def _ladder(payload: Dict[str, Any], second_pass: bool = False, keep_parking: bool = False, strict_brief: bool = False):
    """Yield (level, adjusted payload, notes, compactness) from the exact request to the leanest sensible one.

    The requested parking is a requirement: every step (compact rooms, fewer optional rooms) is tried WITH the parking first.  The floor count
    is a requirement too and is never changed: no rung adds a floor.
    Only when none of them works is the whole ladder repeated without parking, and then the plan says so.  `keep_parking` never drops it.
    `strict_brief` (the user switched "let the planner adjust my brief" off) never adds a floor: whatever has to give is dropped
    from the plan and reported as unmet.  The setbacks are never touched in either mode: they are a legal limit, not a preference."""
    if not (payload.get("parking_required") and not second_pass and not keep_parking):
        yield from _ladder_core(payload, second_pass, strict_brief)
        return
    if not strict_brief:
        # adjust mode: the whole ladder is tried with the parking before the parking is given up
        yield from _ladder_core(payload, second_pass, strict_brief)
        off = dict(payload, parking_required=False, parking_spaces=0, parking_type="No Parking")
        for lv, adj, notes, comp in _ladder_core(off, False, strict_brief):
            yield lv, adj, [PARKING_DROPPED_NOTE] + list(notes), comp
        return
    # the two ladders (with the parking, and without it) advance together: at every degree of leanness the parking-keeping rung is tried first
    # and its parking-free twin right after it, so the parking is only given up at the step where keeping it would cost more rooms
    off = dict(payload, parking_required=False, parking_spaces=0, parking_type="No Parking")
    keep_it = _ladder_core(payload, second_pass, strict_brief)
    drop_it = _ladder_core(off, False, strict_brief)
    lv = 0
    live = [True, True]
    while any(live):
        if live[0]:
            try:
                _, adj, notes, comp = next(keep_it)
                yield lv, adj, list(notes), comp
                lv += 1
            except StopIteration:
                live[0] = False
        if live[1]:
            try:
                _, adj, notes, comp = next(drop_it)
                yield lv, adj, [PARKING_DROPPED_NOTE] + list(notes), comp
                lv += 1
            except StopIteration:
                live[1] = False


def _variants_of(base: Dict[str, Any]):
    """Ways to lay the SAME brief out differently (nothing the user asked for changes): every bedroom upstairs, and a code-minimum stair."""
    out = []
    multi = base.get("building_type", "Ground") not in ("Ground",)
    n_beds = sum(1 for r in base["rooms"] if r.get("room_type") in ("master_bedroom", "bedroom", "guest_bedroom"))
    if multi and n_beds >= 3:
        out.append({"_ground_bedroom": False})
    if multi:
        out.append({"_compact_stair": True})
    if multi and n_beds >= 3:
        out.append({"_ground_bedroom": False, "_compact_stair": True})
    return out


def _ladder_core(payload: Dict[str, Any], second_pass: bool = False, strict_brief: bool = False):
    """The ladder for one parking setting: exact brief -> other floor distributions / code-minimum stair -> compact rooms, then (adjust mode)
    ever leaner room programmes.  The number of floors is never changed."""
    base = dict(payload)
    base["rooms"] = list(payload["rooms"])
    seen = set()
    level = 0
    comp = 1.0
    pre: List[str] = []

    def emit(cur, notes):
        nonlocal level
        key = (comp, cur.get("building_type"), bool(cur.get("parking_required")), cur.get("parking_type"), bool(cur.get("balcony_required")),
               bool(cur.get("_skip_ground_toilet")), cur.get("_ground_bedroom"), bool(cur.get("_compact_stair")),
               tuple(sorted(r.get("room_type", "") for r in cur["rooms"])))
        if key in seen:
            return None
        seen.add(key)
        level += 1
        return level - 1, dict(cur, rooms=list(cur["rooms"])), list(notes), comp

    first = emit(base, list(pre))
    if first:
        yield first
    variants = _variants_of(base)
    for extra in variants:                                    # same brief, laid out differently
        e = emit(dict(base, **extra), list(pre))
        if e:
            yield e
    for comp in (0.92, 0.85):                                 # keep every room and the parking, make the rooms smaller (never below the code minimum)
        e = emit(base, list(pre))
        if e:
            yield e
        for extra in variants:
            e = emit(dict(base, **extra), list(pre))
            if e:
                yield e
    comp = 0.88
    cur = dict(base, rooms=list(base["rooms"]))
    notes: List[str] = list(pre)
    # a smaller parking arrangement: the second car, then the bikes, are the first things the porch gives up
    if cur.get("parking_required") and cur.get("parking_type") in ("2 Cars", "Car + Bikes"):
        was = cur["parking_type"]
        cur["parking_type"] = "1 Car"
        cur["parking_spaces"] = 1
        notes.append("The porch was reduced to a single car under the shade because " + (
            "two vehicles would leave too little width for the rooms on this frontage." if was == "2 Cars" else
            "the bike bay would leave too little width for the rooms on this frontage."))
        for extra in [{}] + variants:
            e = emit(dict(cur, **extra), notes)
            if e:
                yield e
    comp = 0.92                          # from here on: compact rooms allowed
    best_variant = variants[-1] if variants else {}

    def p_optional(c):
        r = _drop(c, _OPTIONAL_1)
        return ("Left out to fit the plot: " + ", ".join(sorted(set(r))) + ".") if r else None
    def p_balcony(c):
        if c.get("balcony_required"):
            c["balcony_required"] = False
            return ("The upper-floor balcony could not be kept on this plot without dropping rooms you "
                    "asked for, so it was left out.")
    def p_three(c):
        cut = _trim_bedrooms(c, 3); rem = _drop(c, ("dining",))
        if cut or rem:
            return "Reduced the programme to a 3-bedroom home" + (" without a separate dining room" if rem else "") + "."
    def p_two(c):
        return "Reduced to 2 bedrooms." if _trim_bedrooms(c, 2) else None
    def p_baths(c):
        n_beds = sum(1 for r in c["rooms"] if r.get("room_type") in ("master_bedroom", "bedroom", "guest_bedroom"))
        baths = [r for r in c["rooms"] if r.get("room_type") == "bathroom"]
        extra = max(0, len(baths) - n_beds)
        if extra:
            drop = {id(r) for r in baths[::-1][:extra]}
            c["rooms"] = [r for r in c["rooms"] if id(r) not in drop]
            return f"Bathrooms reduced to one per bedroom ({extra} fewer)."
    def p_min(c):
        _trim_bedrooms(c, 1)
        c["rooms"] = [r for r in c["rooms"] if r.get("room_type") in
                      ("living_room", "kitchen", "master_bedroom", "bathroom")]
        return "Reduced to the essentials: living room, kitchen, one bedroom and bathroom."

    steps = [None, p_baths, p_balcony, p_optional, p_three, p_two, p_baths, p_min, "tighter"]
    cur.update(best_variant)             # the leaner programmes are tried with the most compact way of laying the same rooms out
    for step in steps:
        if step == "tighter":
            comp = 0.85
            notes.append("Rooms reduced to the smallest workable sizes.")
            step = None
        if step is not None:
            msg = step(cur)
            if msg:
                notes.append(msg)
        # the floor count is a requirement, never a lever: the same floors, smaller rooms before fewer rooms
        c2 = dict(cur, rooms=list(cur["rooms"]))
        c_start = comp
        for comp in sorted({c_start, 0.85, 0.7}, reverse=True):
            n3 = notes + (["Rooms reduced to the smallest workable sizes."] if comp < c_start else [])
            e = emit(c2, n3)
            if e:
                yield e
        comp = c_start


_CACHE: "OrderedDict[str, Dict[str, Any]]" = None  # type: ignore


def generate(payload: Dict[str, Any], budget_s: float = 14.0, seed: int | None = None,
             max_total_s: float = 90.0) -> Dict[str, Any]:
    """Cached front door: the same brief returns the same plans instantly (the search is seeded)."""
    import copy, json
    from collections import OrderedDict
    global _CACHE
    if _CACHE is None:
        _CACHE = OrderedDict()
    try:
        key = json.dumps([payload, budget_s, seed, max_total_s], sort_keys=True, default=str)
    except (TypeError, ValueError):
        key = None
    if key is not None and key in _CACHE:
        _CACHE.move_to_end(key)
        return copy.deepcopy(_CACHE[key])
    res = _generate_uncached(payload, budget_s, seed, max_total_s)
    if key is not None:
        _CACHE[key] = copy.deepcopy(res)
        while len(_CACHE) > 12:
            _CACHE.popitem(last=False)
    return res


def _generate_uncached(payload: Dict[str, Any], budget_s: float = 14.0, seed: int | None = None,
                       max_total_s: float = 90.0) -> Dict[str, Any]:
    """Plan exactly the brief.  Strict mode (the default) never changes floors, rooms, parking or terrace: if the exact brief cannot be planned it
    raises `NoLayout` with the precise conflicts (or, when `closest_if_infeasible` is set, also returns the closest valid alternative, labelled).
    Flexible mode ("let the planner adjust my brief") may shrink rooms and drop optional ones, lists every change, and never adds a floor."""
    from backend.planner.architect.spec import build_spec, normalise_site
    payload = normalise_site(payload)                 # the user's frontage choice, resolved once, before anything is planned
    payload["rooms"] = [r if isinstance(r, dict) else {"room_type": str(r)} for r in payload.get("rooms", [])]
    applied: List[Dict[str, Any]] = []
    if payload.get("approved_adjustments"):           # only what the user ticked is applied; each is a preference, never a floor / room / parking
        from backend.planner.architect.diagnostics import apply_adjustments
        payload, applied = apply_adjustments(payload, list(payload["approved_adjustments"]))
    strict = payload.get("strict", True) is not False
    spec = build_spec(payload)                        # frozen: no later step may change what was asked for
    fp0 = spec.fingerprint()
    with _LOCK:
        from backend.planner.architect import doors as _doors
        _doors.OPEN["puja"] = "open" if str(payload.get("puja_style", "closed")).lower() == "open" else "closed"
        _doors.OPEN["vent"] = str(payload.get("ventilation", "Balanced"))
        try:
            set_strict(strict)
            status = "ok"
            if strict:
                try:
                    res = _generate_strict(payload, budget_s, seed, max_total_s)
                except (Infeasible, NoLayout) as exc:
                    if not payload.get("closest_if_infeasible"):
                        _raise_conflict(payload, spec, exc)          # nothing is dropped, added or faked: the conflict is reported
                    from backend.planner.architect.diagnostics import diagnose
                    verdict_ = "infeasible" if isinstance(exc, Infeasible) else getattr(exc, "verdict", "inconclusive")
                    res = _best_effort(payload, budget_s, seed, max_total_s, exc)
                    status = "closest_alternative"
                    res["diagnostic"] = diagnose(payload, verdict=verdict_, attempts=getattr(exc, "attempts", None))
            else:
                from backend.planner.architect.rules import set_aspect
                set_aspect(1.6)               # 'let the planner adjust' mode may also widen room shapes
                try:
                    res = _generate_relaxing(payload, budget_s, seed, max_total_s)      # may drop / shrink rooms, never floors; every change is listed
                except (Infeasible, NoLayout) as exc:
                    _raise_diagnosed(payload, exc)
            res = _finalise(res, payload, strict, spec)
            if status == "ok" and not res["compliance"]["exact"]:
                status = "adjusted"
            res["status"] = status
            if applied:
                if res["status"] == "ok":
                    res["status"] = "adjusted"
                res["approved_adjustments"] = applied
                res["warnings"] = list(res.get("warnings", [])) + [
                    "Changed with your approval: " + "; ".join(a["label"] for a in applied) + ". Everything else in the brief is as you set it."]
            unmet = (res.get("compliance") or {}).get("unmet") or []
            if status == "closest_alternative":
                res["outcome"] = "closest_alternative"          # never presented as the exact brief
                res["exact"] = False
                res["deviations"] = [{"kind": "not_provided", "label": u["label"], "requested": u["requested"], "delivered": u["delivered"]} for u in unmet] + \
                                    [{"kind": "compromise", "label": c} for c in ((res.get("relaxation") or {}).get("compromises") or [])]
            elif applied or unmet:
                res["outcome"] = "mandatory_only"
                res["exact"] = False
                res["deviations"] = [{"kind": "approved_change", "label": a["label"], "from": a["from"], "to": a["to"], "reason": a["reason"]} for a in applied] + \
                                    [{"kind": "not_provided", "label": u["label"], "requested": u["requested"], "delivered": u["delivered"]} for u in unmet]
            else:
                res["outcome"] = "exact"
                res["exact"] = True
                res["deviations"] = []
            assert build_spec(payload).fingerprint() == fp0, "the requirement specification changed during planning"
            return res
        finally:
            _doors.OPEN.update({"puja": "closed", "vent": "Balanced"})
            set_compact(1.0)
            set_strict(True)


def _conflicts(payload: Dict[str, Any], spec, exc=None) -> List[Dict[str, Any]]:
    """The precise constraints that cannot be met together, for the user (never a generic failure, and never a blame that the numbers do not support)."""
    from backend.planner.architect.diagnostics import diagnose
    rep = getattr(exc, "report", None) or check_request(payload, suggest=False)
    out: List[Dict[str, Any]] = []
    for f in ((rep or {}).get("floors", []) if not (rep or {}).get("errors") else []):      # (the report's own errors already say it, with the same numbers)
        if f.get("status") == "infeasible":
            out.append({"code": "AREA", "floor": f["floor"], "message":
                        f"{f['floor']}: its {f['rooms']} rooms need at least {f['min_area_needed']} sq ft but {f['buildable_area']} sq ft is buildable after the setbacks "
                        f"({(rep or {}).get('buildable_frontage')} x {(rep or {}).get('buildable_depth')} ft)."})
    for e in (rep or {}).get("errors", []):
        out.append({"code": "FEASIBILITY", "message": e})
    d = getattr(exc, "diagnostic", None) or diagnose(payload, verdict=getattr(exc, "verdict", "unknown"), attempts=getattr(exc, "attempts", None))
    for f in d.get("failed_mandatory", []):
        if f["constraint"] == "parking":                 # parking is named only when the numbers show it does not fit
            out.append({"code": "PARKING", "message": f["detail"]})
    if getattr(exc, "verdict", "") == "inconclusive":
        n = len(getattr(exc, "attempts", []) or [])
        out.append({"code": "SEARCH_INCONCLUSIVE", "message":
                    f"No valid arrangement was found within the search performed ({n} attempts). The area check says the brief can fit: this is not proof that it cannot."})
    for c in getattr(exc, "conflicts", []) or []:
        out.append(c)
    seen, uniq = set(), []
    for c in out:
        if c["message"] not in seen:
            seen.add(c["message"]); uniq.append(c)
    return uniq


def _raise_conflict(payload, spec, exc):
    """Strict mode, exact brief not planned: say honestly what is known (proved infeasible vs not found) instead of dropping rooms, adding a floor or
    inventing a terrace, and attach the constraint diagnostic."""
    from backend.planner.architect.diagnostics import diagnose
    rep = getattr(exc, "report", None) or check_request(payload, suggest=True)
    verdict = "infeasible" if isinstance(exc, Infeasible) else getattr(exc, "verdict", "inconclusive")
    attempts = getattr(exc, "attempts", []) or []
    d = diagnose(payload, verdict=verdict, attempts=attempts)
    exc.diagnostic = d
    exc.verdict = verdict
    conflicts = _conflicts(payload, spec, exc)
    if verdict == "infeasible" and d.get("blocked_by_preferences"):
        labels = [a["label"] for a in d["adjustable_preferences"] if a["id"] in d["blocked_by_preferences"]]
        lead = ("Your exact brief does not fit because of a preference, not because the plot is too small for the house: " + (" ".join(c["message"] for c in conflicts[:2]) or d["summary"]) +
                " Changing only that preference would work (" + "; ".join(labels) + ") - it needs your approval and is not applied automatically.")
    elif verdict == "infeasible":
        lead = "Your brief cannot be planned on this plot: " + (" ".join(c["message"] for c in conflicts[:3]) if conflicts else d["summary"])
    else:
        lead = ("Your exact brief was not planned: no valid arrangement was found within the search performed. " +
                " ".join(c["message"] for c in conflicts if c["code"] != "SEARCH_INCONCLUSIVE")[:600])
    msg = lead.strip() + " Nothing was removed, added or relaxed behind your back (the floor count, room counts, parking and terrace are exactly as you set them)."
    ex = NoLayout(rep, msg, conflicts)
    ex.infeasible = verdict == "infeasible"
    ex.verdict = verdict
    ex.attempts = attempts
    ex.diagnostic = d
    raise ex


def _strict_worker(payload, budget_s, seed):
    """One strict attempt in its own process (the rule switches are process-wide)."""
    set_strict(True)
    set_compact(1.0)
    try:
        res = _generate_once(dict(payload, _relaxed=False), budget_s=budget_s, seed=seed)
        flags = {"util_corner": STRICT["util_corner"], "bath_ext": STRICT["bath_ext"], "aspect": STRICT["aspect"], "max_pass": STRICT["max_pass"]}
        return res, flags
    except NoLayout:
        return None, None


# Search plan of the strict mode.  Each stage is one way of looking for the EXACT brief (every room, floor, the parking and the terrace as asked);
# a stage only loosens a layout-quality rule or the comfort size of rooms, never what the user asked for.  Stages are tried in this order, quality-first,
# and each is tried with several seeds because the search is randomised: a single unlucky seed is not evidence that nothing fits.
_STAGES = (
    # name,                                      compact, pass_cap, aspect, seeds, allocation (None = the programme's own split, False/True = bedroom downstairs switch)
    ("comfortable sizes, no long-passage cap",      1.00, False, 1.6, 3, None),
    ("rooms up to 8% smaller",                      0.92, False, 1.6, 2, None),
    ("all bedrooms upstairs",                       1.00, False, 1.6, 1, False),
    ("one more bedroom downstairs",                 1.00, False, 1.6, 1, True),
    ("rooms up to 15% smaller",                     0.85, False, 1.6, 2, None),
    ("rooms up to 22% smaller",                     0.78, False, 1.8, 2, None),
    ("rooms up to 30% smaller",                     0.70, False, 2.0, 1, None),
    ("rooms up to 38% smaller",                     0.62, False, 2.2, 1, None),
)


def _alloc_alternatives_allowed(payload) -> bool:
    """The floor split may be varied by the search only when the user did not fix it (per-floor room lists, an elder who must sleep downstairs)."""
    if payload.get("floor_rooms"):
        return False
    ctx = payload.get("family_context") or {}
    if int(ctx.get("elderly", 0) or 0) > 0 or ctx.get("ground_floor_master_required"):
        return False
    return sum(1 for r in payload["rooms"] if r.get("room_type") in _BEDS) >= 3


def _stage_notes(compact: float) -> List[str]:
    notes = []
    if compact < 1.0:
        notes.append(f"Rooms are up to {round((1 - compact) * 100)}% smaller than the comfortable sizes so that every room you asked for fits "
                     "on this plot (nothing was removed).")
    if STRICT["aspect"] > 1.26:
        notes.append("Some rooms are longer than 1:1.25 (up to 1:%.1f)." % STRICT["aspect"])
    if not STRICT["pass_cap"]:
        notes.append("A hall / passage longer than the usual short-lobby limit is used where it is needed to reach every room without crossing another.")
    if not STRICT["util_corner"]:
        notes.append("The utility sits on an outer wall but may not be in a corner.")
    if not STRICT["bath_ext"]:
        notes.append("No layout kept every bathroom on an outer wall at these sizes, so at least one bathroom is inside "
                     "the house and its pipes run through the duct shown on the plan.")
    return notes


def _generate_strict(payload, budget_s, seed, max_total_s: float = 90.0):
    """Plan exactly the brief: rooms, floors, parking and sizes are never changed behind the user's back.

    The search is randomised and clock-bounded, so ONE failed run proves nothing.  The brief is therefore searched through the stages of `_STAGES`
    (each with several seeds, alternative floor splits where the user did not fix them, and ever more compact room sizes) until a valid layout turns up
    or the time allowed is spent.  Every attempt is logged; when nothing is found the caller gets `NoLayout` with `verdict == "inconclusive"`
    (nothing found within the search performed), never a claim that the brief is impossible: only the area analysis can prove that (`Infeasible`)."""
    t0 = time.time()
    set_compact(1.0)
    nf_ = {"G+1": 2, "G+2": 3}.get(str(payload.get("building_type", "")), 1)
    b_att = max(budget_s, 14.0) * {1: 0.8, 2: 1.25, 3: 2.0}[nf_]
    cap_s = max(max_total_s, 60.0)
    try:
        st = check_request(payload).get("status")
    except Exception:
        st = None
    attempts: List[Dict[str, Any]] = []
    allow_alloc = _alloc_alternatives_allowed(payload)
    seed0 = seed or 7

    def finish(res, compact, name):
        res["relaxation"] = {"level": 0 if compact >= 1.0 else 1, "exact": True, "adjustments": []}
        notes = _stage_notes(compact)
        if compact < 1.0:
            res["relaxation"].update({"compromises": notes,
                                      "requested": {"building_type": payload.get("building_type"), "parking_required": bool(payload.get("parking_required")),
                                                    "rooms": [r.get("room_type") for r in payload["rooms"]]}})
            res["relaxation"]["delivered"] = res["relaxation"]["requested"]
            res["warnings"] = list(res.get("warnings", [])) + ["Your brief was kept in full, but it is tight for this plot: " + " ".join(notes)]
        elif notes:
            res["warnings"] = list(res.get("warnings", [])) + notes
        if any(r_["room_type"] == "passage" for p_ in res["plans"] for f_ in p_["floors"] for r_ in f_["layout"]["rooms"]):
            res["warnings"] = list(res.get("warnings", [])) + [
                "A passage was kept where it was needed to reach every room without crossing another; no other passages were added."]
        res["search"]["total_elapsed_s"] = round(time.time() - t0, 1)
        res["search"]["strategy"] = name
        res["search"]["attempt_log"] = attempts
        res["search"]["verdict"] = "exact"
        return res

    def run(name, compact, pass_cap, aspect, sd, alloc, budget, giveup, comfort=False):
        set_compact(compact)
        if comfort:
            set_strict(True)                    # every layout-quality rule on
        else:
            STRICT.update({"util_corner": False, "bath_ext": True, "max_pass": 4, "passage_ok": True, "pass_cap": pass_cap})
            set_aspect(aspect)
        p = dict(payload, _relaxed=False, _giveup=giveup)
        if alloc is not None:
            p["_ground_bedroom"] = alloc
        t1 = time.time()
        rec = {"strategy": name, "compact": compact, "seed": sd, "ground_bedroom": alloc, "long_passage_allowed": not (comfort or pass_cap),
               "outcome": "layout found"}
        try:
            res = _generate_once(p, budget_s=budget, seed=sd)
        except Infeasible:
            raise
        except NoLayout:
            res = None
            rec["outcome"] = "no valid layout"
        rec["seconds"] = round(time.time() - t1, 1)
        attempts.append(rec)
        return res

    # 1. comfort pass: every layout-quality rule on (the best layouts when the plot is roomy enough)
    if st != "very_tight":
        res = run("every layout rule, comfortable sizes", 1.0, True, 1.25, seed0, None, b_att, 0.5, comfort=True)
        if res is not None:
            return finish(res, 1.0, "every layout rule, comfortable sizes")
    # 2. the staged sweep
    for name, compact, pass_cap, aspect, nseeds, alloc in _STAGES:
        if st == "very_tight" and compact > 0.9:
            continue
        if alloc is not None and not allow_alloc:
            continue
        for k in range(nseeds):
            if time.time() - t0 > cap_s:
                break
            res = run(name, compact, pass_cap, aspect, seed0 + 977 * k + 311 * int(round((1 - compact) * 100)), alloc, b_att, 0.85)
            if res is not None:
                return finish(res, compact, name)
        if time.time() - t0 > cap_s:
            break
    rep = check_request(payload, suggest=True)
    done = len(attempts)
    msg = (f"No valid arrangement was found within the search performed ({done} planning attempts over different seeds, room sizes"
           f"{', floor splits' if allow_alloc else ''} and passage rules, {round(time.time() - t0)} s). This is not a proof that the brief is impossible: "
           "the area check says it can fit, but the layout search did not find every room, the parking and the circulation together. "
           "Nothing was changed behind your back.")
    ex = NoLayout(rep, msg)
    ex.verdict = "inconclusive"
    ex.attempts = attempts
    raise ex


def _compromises(adj: Dict[str, Any], compact: float) -> List[str]:
    """Layout compromises (not changes to what the user asked for) that a rung of the ladder used."""
    out: List[str] = []
    if compact < 1.0:
        out.append(f"Rooms are planned up to {round((1 - compact) * 100)}% below the comfortable minimum sizes (never below the code minimum for "
                   "each room).")
    if adj.get("_compact_stair"):
        out.append("The staircase uses code-minimum proportions (175 mm risers, 250 mm treads) instead of the project's gentler 150 / 300 mm to save floor area.")
    if adj.get("_ground_bedroom") is False:
        out.append("Every bedroom is upstairs; the ground floor keeps the living, dining, kitchen and parking.")
    return out


_BEDS = ("master_bedroom", "bedroom", "guest_bedroom")
_OPT_KEEP = ("dining", "utility", "puja_room", "study", "family_lounge")
_OPT_LOSS = {"dining": 4.0, "utility": 3.0, "puja_room": 2.0, "study": 2.0, "family_lounge": 2.0}


def _program_space(payload: Dict[str, Any]):
    """Every smaller programme the brief could shrink to, as (loss, vector, builder).  The loss uses the same priorities as the compliance report
    (a bedroom counts most, then the parking, bathrooms, dining ...); the vector lets a failure rule out every programme that asks for more."""
    rooms = payload["rooms"]
    n_b = sum(1 for r in rooms if r.get("room_type") in _BEDS)
    n_t = sum(1 for r in rooms if r.get("room_type") == "bathroom")
    present = [t for t in _OPT_KEEP if any(r.get("room_type") == t for r in rooms)]
    has_bal = bool(payload.get("balcony_required"))
    ptype = payload.get("parking_type", "")
    has_park = bool(payload.get("parking_required"))
    two_part = has_park and ptype in ("2 Cars", "Car + Bikes")
    pr_levels = ([2, 1, 0] if two_part else [2, 0]) if has_park else [2]
    out = []
    import itertools
    for kb in range(max(n_b, 1), 0, -1):
        for kt in range(n_t, max(0, min(n_t, 1) - 1) - 0, -1) if n_t else [0]:
            if kt < min(n_t, kb) and n_t >= kb and kt < 1:
                continue
            for keep in itertools.product([True, False], repeat=len(present)):
                for bal in ([True, False] if has_bal else [True]):
                    for pr in pr_levels:
                        loss = 10.0 * (n_b - kb) + 3.0 * (n_t - kt) + sum(_OPT_LOSS[t] for t, k in zip(present, keep) if not k)
                        loss += 0.0 if bal else 2.0
                        loss += {2: 0.0, 1: 3.0, 0: 8.0}[pr] if has_park else 0.0
                        vec = (kb, kt) + tuple(1 if k else 0 for k in keep) + (1 if bal else 0, pr)
                        out.append((loss, -sum(vec), vec, (kb, kt, dict(zip(present, keep)), bal, pr)))
    out.sort(key=lambda x: (x[0], x[1]))
    return [(o[0], o[2], o[3]) for o in out], present


def _program_payload(payload: Dict[str, Any], spec) -> tuple:
    kb, kt, keep, bal, pr = spec
    rooms = list(payload["rooms"])
    notes: List[str] = []
    beds = [r for r in rooms if r.get("room_type") in _BEDS]
    cut = len(beds) - kb
    if cut > 0:
        drop = {id(r) for r in [b for b in beds if b.get("room_type") != "master_bedroom"][::-1][:cut]}
        rooms = [r for r in rooms if id(r) not in drop]
        notes.append(f"Bedrooms: {kb} planned instead of {len(beds)}.")
    baths = [r for r in rooms if r.get("room_type") == "bathroom"]
    if len(baths) > kt:
        drop = {id(r) for r in baths[::-1][:len(baths) - kt]}
        rooms = [r for r in rooms if id(r) not in drop]
        notes.append(f"Bathrooms: {kt} planned instead of {len(baths)}.")
    gone = [t for t, k in keep.items() if not k]
    if gone:
        rooms = [r for r in rooms if r.get("room_type") not in gone]
        notes.append("Left out to fit the plot: " + ", ".join(t.replace("_", " ") for t in gone) + ".")
    adj = dict(payload, rooms=rooms)
    if not bal and payload.get("balcony_required"):
        adj["balcony_required"] = False
        notes.append("The balcony was left out.")
    if payload.get("parking_required"):
        if pr == 0:
            adj.update(parking_required=False, parking_spaces=0, parking_type="No Parking")
            notes.append(PARKING_DROPPED_NOTE)
        elif pr == 1:
            adj.update(parking_type="1 Car", parking_spaces=1)
            notes.append("The bike bay / second car space was dropped; one car is still parked under the porch.")
    return adj, notes


def _scored_search(payload, budget_s, seed, max_total_s):
    """Strict mode, exact brief impossible: walk through the smaller programmes from the least to the most costly one (by the compliance
    priorities), skipping every programme that asks for at least as much as one that already failed, and return the first that can be laid
    out.  It is then refined: the same programme is retried with comfortable room sizes before the compact ones are accepted."""
    t0 = time.time()
    space, present = _program_space(payload)
    failed: List[tuple] = []
    tried = 0
    first_err: Exception | None = None
    cache: Dict[tuple, Any] = {}

    def laid_out(vec, spec):
        """(adj, notes, variant) when the programme can be laid out at the most compact sizes, else None (remembered)."""
        nonlocal tried, first_err
        if vec in cache:
            return cache[vec]
        adj, notes = _program_payload(payload, spec)
        out = None
        try:                                                    # a programme whose rooms cannot fit the plot by area is ruled out at once
            bad = check_request(dict(adj, _ground_bedroom=False if spec[0] >= 3 else None), suggest=False)["status"] in ("infeasible", "invalid")
        except Exception:
            bad = False
        if not bad:
            multi_bed = spec[0] >= 3 and adj.get("building_type", "Ground") != "Ground"
            variants = [dict(_compact_stair=True, _ground_bedroom=False)] if multi_bed else [dict(_compact_stair=True)]
            if multi_bed:
                variants.append(dict(_compact_stair=True))
            for var in variants:
                for comp0 in (0.85, 0.7):               # compaction is not monotone for the search (the smallest sizes can fail where a middle one works)
                    tried += 1
                    set_compact(comp0)
                    try:
                        _generate_once(dict(adj, _relaxed=True, **var), budget_s=max(4.0, budget_s * 0.4), seed=seed)
                        out = (adj, notes, var)
                        break
                    except (Infeasible, NoLayout) as exc:
                        first_err = first_err or exc
                if out:
                    break
        cache[vec] = out
        return out

    # Probe the leanest programme for each bedroom count, most bedrooms first.  Dropping every optional room only makes a plan easier, so a
    # failed probe rules out every programme with that many bedrooms or more at once, instead of trying their variants one by one.
    n_b = max(1, max(sp[0] for _, _, sp in space))
    n_t = max(sp[1] for _, _, sp in space)
    for kb in range(n_b, 0, -1):
        if time.time() - t0 > max_total_s * 0.5:
            break
        cand = sorted(((v, sp) for _, v, sp in space if sp[0] == kb), key=lambda x: sum(x[0]))
        if not cand:
            continue
        v0, sp0 = cand[0]
        if laid_out(v0, sp0) is not None:
            break
        failed.append(v0)
    for loss, vec, spec in space:
        if time.time() - t0 > max_total_s:
            break
        if any(all(a >= f for a, f in zip(vec, fv)) for fv in failed):
            continue
        got = laid_out(vec, spec)
        if got is None:
            failed.append(vec)
            continue
        adj, notes, ok = got
        best = None
        for comp in (1.0, 0.92, 0.85, 0.78, 0.7):                    # the roomiest sizes that still work
            set_compact(comp)
            try:
                best = (comp, _generate_once(dict(adj, _relaxed=True, **ok), budget_s=max(4.0, budget_s * 0.4), seed=seed))
                break
            except (Infeasible, NoLayout):
                continue
        if best is None:
            failed.append(vec)
            continue
        comp, res = best
        compromises = _compromises(dict(adj, **ok), comp)
        res["relaxation"] = {
            "level": 1 if notes else 0, "exact": not notes, "adjustments": notes, "compromises": compromises,
            "requested": {"building_type": payload.get("building_type"), "parking_required": bool(payload.get("parking_required")),
                          "rooms": [r.get("room_type") for r in payload["rooms"]]},
            "delivered": {"building_type": adj.get("building_type"), "parking_required": bool(adj.get("parking_required")),
                          "rooms": [r.get("room_type") for r in adj["rooms"]]},
        }
        if notes:
            res["warnings"] = list(res.get("warnings", [])) + [
                "Your exact brief could not be planned on this plot; the closest valid plan leaves out or changes: " + " ".join(notes)]
        if compromises:
            res["warnings"] = list(res.get("warnings", [])) + ["To fit the plot: " + " ".join(compromises)]
        res["search"]["total_elapsed_s"] = round(time.time() - t0, 1)
        res["search"]["programmes_tried"] = tried
        res["search"]["programme_loss"] = loss
        return res
    raise first_err if first_err else NoLayout({}, "No layout could be produced for this plot.")


def _best_effort(payload, budget_s, seed, max_total_s, first_exc, strict_brief=True):
    """The exact brief (and, in adjust mode, every adjustment) failed: return the closest valid plan instead of an error.

    Everything that had to give is dropped from the plan -- never faked -- and listed as unmet in `compliance`.  Hard rules (setbacks, no
    overlap, stairs, circulation, doors, minimum sizes) are not part of the search space.  Only when no valid geometry exists at all does this
    re-raise, with the diagnosis."""
    from backend.planner.architect.rules import set_aspect
    t0 = time.time()
    STRICT.update({"util_corner": True, "bath_ext": True, "max_pass": 2, "passage_ok": False})
    set_compact(1.0)
    set_aspect(1.6)
    try:
        if strict_brief:
            res = _scored_search(payload, budget_s, seed, max(50.0, max_total_s - (time.time() - t0)))      # a closest plan is always worth at least this long
        else:
            res = _generate_relaxing(payload, budget_s, seed, max(30.0, max_total_s - (time.time() - t0)), keep_parking=False, strict_brief=strict_brief)
        res["search"]["best_effort"] = True
        return res
    except (Infeasible, NoLayout) as exc:
        _raise_diagnosed(payload, first_exc if getattr(first_exc, "report", None) else exc)


def _raise_diagnosed(payload, exc):
    rep = getattr(exc, "report", None) or check_request(payload, suggest=True)
    if isinstance(exc, Infeasible):
        raise Infeasible(rep)
    raise NoLayout(rep, getattr(exc, "message", None) or _diagnosis(payload, rep))


def _diagnosis(payload, rep) -> str:
    """Why nothing at all could be built, in words (used only when even the leanest valid programme does not fit)."""
    why = "; ".join(rep.get("errors", [])[:2]) if isinstance(rep, dict) else ""
    box = (rep or {}).get("buildable_frontage"), (rep or {}).get("buildable_depth")
    msg = ("No valid plan could be built for this plot, not even a reduced one: " + (why + " " if why else "") +
           (f"The buildable area after setbacks is {box[0]} x {box[1]} ft. " if all(box) else "") +
           "The setbacks you entered are never reduced by the planner. Smaller setbacks (if your local rules allow), a larger plot or a different "
           "road side would give it room.")
    return msg


_SHAPED = ("living_room", "dining", "kitchen", "master_bedroom", "bedroom", "guest_bedroom", "study", "family_lounge")


def _widest_room(plan):
    """(aspect ratio, name) of the least square habitable room in a plan, counted from the plan itself."""
    best = None
    for fl in plan.get("floors", []):
        for r in fl["layout"]["rooms"]:
            if r.get("room_type") in _SHAPED and r.get("width") and r.get("length"):
                a, b = sorted((float(r["width"]), float(r["length"])))
                ratio = b / a if a else 99.0
                if best is None or ratio > best[0]:
                    best = (ratio, r.get("name") or r["room_type"])
    return best


def _finalise(res: Dict[str, Any], original: Dict[str, Any], strict: bool, spec=None) -> Dict[str, Any]:
    """Attach the requirement-compliance report and the requirement ledger (both computed from what each plan really contains, against the
    ORIGINAL brief) and search statistics."""
    from backend.planner.architect.requirements import compliance
    from backend.planner.architect.spec import build_spec, ledger
    from backend.planner.architect.facade import apply_chajjas, apply_envelope
    spec = spec or build_spec(original)
    for p_ in res.get("plans", []):
        apply_chajjas(p_, original)
        apply_envelope(p_, original)
    rel = res.get("relaxation") or {"level": 0, "exact": True, "adjustments": []}
    comps = rel.get("compromises", [])
    notes = list(rel.get("adjustments", []))
    reports = []
    for p in res.get("plans", []):
        comps_p = list(comps)
        wide = _widest_room(p)
        if wide and wide[0] > 1.26 and not any("longer than 1:1.25" in c for c in comps_p + notes):
            comps_p.append(f"Some rooms are longer than the preferred 1:1.25 shape (the {wide[1]} is 1:{wide[0]:.2f}); this is a shape preference, "
                           "not a code minimum.")
        for fi_, fl_ in enumerate(p.get("floors", [])):
            if fi_ == 0:
                continue
            rs_ = fl_["layout"]["rooms"]
            entered = [r for r in rs_ if r["room_type"] not in ("staircase", "open_terrace", "balcony", "parking", "bike_parking", "garden")
                       and not (r["room_type"] == "bathroom" and r.get("attached_to"))]
            if entered and len(entered) <= 2 and not any(r["room_type"] in ("passage", "family_lounge") for r in entered):
                comps_p.append(f"Floor {fi_ + 1}: its {len(entered)} room(s) open straight off the stair landing; there is no separate corridor on this floor.")
        rep = compliance(original, p, strict, notes, comps_p)
        p["compliance"] = rep
        p["ledger"] = ledger(spec, p)
        rep["exact"] = bool(rep["exact"]) and p["ledger"]["ok"]
        reports.append(rep)
    if reports:
        worst = min(reports, key=lambda r: r["score"])
        res["compliance"] = dict(worst, plans_scores=[r["score"] for r in reports])
        rel["exact"] = bool(worst["exact"]) and rel.get("level", 0) == 0
        rel["unmet"] = worst["unmet"]
        rel["mode"] = worst["mode"]
        if worst["unmet"]:
            res["warnings"] = list(res.get("warnings", [])) + [
                "Not provided in these plans: " + "; ".join(f"{u['label']} ({u['requested']} asked, {u['delivered']} planned)" for u in worst["unmet"]) + "."]
    res["relaxation"] = rel
    return res


def _generate_relaxing(payload, budget_s, seed, max_total_s, keep_parking=False, strict_brief=False):
    t0 = time.time()
    first_err: Exception | None = None
    retry = []                                   # levels that passed the area check but found no layout

    def attempt(level, adj, notes, compact, b, sd):
        set_compact(compact)
        adj = dict(adj, _relaxed=level > 0)
        res = _generate_once(adj, budget_s=b, seed=sd)
        compromises = _compromises(adj, compact)
        res["relaxation"] = {
            "level": level, "exact": level == 0, "adjustments": notes, "compromises": compromises,
            "requested": {"building_type": payload.get("building_type"),
                          "parking_required": bool(payload.get("parking_required")),
                          "rooms": [r.get("room_type") for r in payload["rooms"]]},
            "delivered": {"building_type": adj.get("building_type"),
                          "parking_required": bool(adj.get("parking_required")),
                          "rooms": [r.get("room_type") for r in adj["rooms"]]},
        }
        if notes:
            res["warnings"] = list(res.get("warnings", [])) + [
                ("Your exact brief could not be planned on this plot; the closest valid plan leaves out or changes: " if strict_brief
                 else "Your exact brief could not be planned on this plot, so it was adjusted: ") + " ".join(notes)]
        if compromises:
            res["warnings"] = list(res.get("warnings", [])) + ["To fit the plot: " + " ".join(compromises)]
        res["search"]["total_elapsed_s"] = round(time.time() - t0, 1)
        return res

    want_park = bool(payload.get("parking_required")) and not keep_parking
    park_deadline = t0 + max_total_s * 0.7          # the levels that keep the parking get most of the time, the parking-free ones the rest
    for level, (_, adj, notes, compact) in enumerate(_ladder(payload, keep_parking=keep_parking, strict_brief=strict_brief)):
        if level > 0 and time.time() - t0 > max_total_s:
            break
        if want_park and adj.get("parking_required") and time.time() > park_deadline:
            continue                                  # out of time for parking-keeping levels: jump on to the parking-free ones
        b = budget_s if level == 0 else max(5.0, budget_s * 0.5)
        try:
            return attempt(level, adj, notes, compact, b, seed)
        except Infeasible as exc:
            first_err = first_err or exc
        except NoLayout as exc:
            first_err = first_err or exc
            retry.append((level, adj, notes, compact))
    # Nothing worked in the time slice (slow machine?): give the most promising levels a longer go.
    for k, (level, adj, notes, compact) in enumerate(retry[-4:][::-1]):
        try:
            return attempt(level, adj, notes, compact, max(budget_s, 14.0), (seed or 7) + 977 * (k + 1))
        except (Infeasible, NoLayout):
            continue
    raise first_err if first_err else NoLayout({}, "No layout could be produced for this plot.")
