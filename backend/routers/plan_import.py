"""Upload a 2D plan image -> Gemini reading -> editable draft -> 3D plan.  Every route needs a signed-in user (same auth as the rest of the API).

The image is held in memory for the duration of the request only: it is not stored, and neither the image, Gemini's answer nor the API key is
ever written to a log."""
from __future__ import annotations

import json
import os
import time
from collections import defaultdict, deque
from typing import Any, Deque, Dict

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from backend.auth import get_current_user
from backend.models import User
from backend.planimport import gemini
from backend.planimport.build import (DraftError, add_assumed_openings, clean_draft, draft_to_plan, reading_to_draft, resolve_scale, suggest_scale,
                                      validate_draft)
from backend.planimport.reading import clean_reading, empty_reading, normalise_reading
from backend.planimport.validate import UploadError, ALLOWED, max_bytes, validate_image

router = APIRouter(prefix="/plan-import", tags=["plan-import"])

_CALLS: Dict[int, Deque[float]] = defaultdict(deque)
MAX_JSON_BYTES = 400_000


def _limit() -> int:
    try:
        return max(1, int(os.getenv("PLAN_IMPORT_PER_HOUR", "8")))
    except ValueError:
        return 8


def _rate_check(user_id: int, now: float | None = None) -> None:
    now = time.time() if now is None else now
    q = _CALLS[user_id]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= _limit():
        wait = int(3600 - (now - q[0])) // 60 + 1
        raise HTTPException(status_code=429, detail={"code": "user_rate_limited", "message": f"You have used {_limit()} plan readings this hour. Try again in about {wait} min."})
    q.append(now)


def _fail(exc: Exception):
    if isinstance(exc, (UploadError, gemini.PlanReadError)):
        raise HTTPException(status_code=exc.status, detail={"code": exc.code, "message": exc.message, "retryable": getattr(exc, "retryable", False)})
    if isinstance(exc, DraftError):
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message, "details": exc.details})
    raise exc


def _body_ok(body: Any) -> Dict[str, Any]:
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail={"code": "bad_body", "message": "Send a JSON object."})
    if len(json.dumps(body, default=str)) > MAX_JSON_BYTES:
        raise HTTPException(status_code=413, detail={"code": "too_large", "message": "The request is too large."})
    return body


@router.get("/status")
def status(user: User = Depends(get_current_user)):
    return {"gemini_available": gemini.available(), "models": gemini.models()[:3], "max_mb": round(max_bytes() / 1048576, 1),
            "allowed_types": sorted(ALLOWED), "per_hour": _limit(),
            "privacy": "The image is sent to Google's Gemini API to be read. It is not stored by this server."}


@router.post("/analyze")
async def analyze(file: UploadFile = File(...), consent: bool = Form(False), manual: bool = Form(False), user: User = Depends(get_current_user)):
    """Validate the image, then (with the user's explicit consent) ask Gemini to read it.  `manual=true` skips Gemini: an empty reading to fill in by hand."""
    try:
        data = await file.read(max_bytes() + 1)
        info = validate_image(data, file.content_type)
        if manual:
            reading = empty_reading(info)
            return {"reading": reading, "scale": suggest_scale(reading), "source": "manual"}
        if not consent:
            raise HTTPException(status_code=428, detail={"code": "consent_required", "message": "Confirm that the image may be sent to Gemini before it is read."})
        if not gemini.available():
            raise gemini.PlanReadError("no_key", "Gemini is not configured on this server (set GEMINI_API_KEY). You can still build the model by adding rooms by hand.", 503)
        _rate_check(user.id)
        raw = gemini.analyze(data, info.mime)
        model = (gemini.models() or [""])[0]
        reading = normalise_reading(raw, info, model=model)
        return {"reading": reading, "scale": suggest_scale(reading), "source": "gemini"}
    except HTTPException:
        raise
    except Exception as exc:                                  # mapped; anything unexpected is re-raised as a plain 500 with no content in it
        _fail(exc)


@router.post("/draft")
def draft(body: Dict[str, Any], user: User = Depends(get_current_user)):
    """Reading + the user's scale choice -> the editable canonical draft (feet).  Deterministic; no Gemini."""
    body = _body_ok(body)
    try:
        reading = clean_reading(body.get("reading"))
        spec = body.get("scale") if isinstance(body.get("scale"), dict) else {}
        if spec.get("mode") == "manual" or (not reading["rooms"] and spec.get("mode") in (None, "manual")):
            scale = {"ft_per_px": None, "source": "manual", "approximate": False, "description": "Drawn by hand: every size is one you typed."}
            d = {"version": 1, "scale": scale, "floor_label": reading.get("floor_label") or "Ground Floor", "rooms": [], "doors": [], "windows": [],
                 "adjustments": [], "uncertainties": reading.get("unknown", []), "assumptions": []}
            d["check"] = validate_draft(d)
            return {"draft": d}
        scale = resolve_scale(reading, spec)
        d = reading_to_draft(reading, scale)
        if body.get("assumed_openings"):
            d = add_assumed_openings(d, str(body.get("road_side") or "South"))
        return {"draft": d}
    except Exception as exc:
        _fail(exc)


@router.post("/check")
def check(body: Dict[str, Any], user: User = Depends(get_current_user)):
    """Validate an edited draft (also recomputes which room each door opens to)."""
    body = _body_ok(body)
    try:
        d = clean_draft(body.get("draft"))
        if body.get("assumed_openings"):
            d = add_assumed_openings(d, str(body.get("road_side") or "South"))
        d["check"] = validate_draft(d)
        return {"draft": d}
    except Exception as exc:
        _fail(exc)


@router.post("/build")
def build(body: Dict[str, Any], user: User = Depends(get_current_user)):
    """Edited draft + design choice -> the plan the 3D viewer builds (same shape as a generated plan).  Deterministic; no Gemini."""
    body = _body_ok(body)
    try:
        d = clean_draft(body.get("draft"))
        if body.get("assumed_openings"):
            d = add_assumed_openings(d, str(body.get("road_side") or "South"))
        plan = draft_to_plan(d, {"road_side": body.get("road_side"), "architectural_style": body.get("architectural_style"),
                                 "site_margin_ft": body.get("site_margin_ft")})
        return {"plan": plan, "draft": d}
    except Exception as exc:
        _fail(exc)
