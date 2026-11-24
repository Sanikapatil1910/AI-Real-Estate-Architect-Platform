"""Saved projects of the signed-in user.  Every query is filtered by the owner: another user's id answers 404, never 403, so ids cannot be probed."""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from backend.auth import get_current_user
from backend.database import get_db
from backend.models import Project, User
from backend.planner.style_knowledge import canonical_style

router = APIRouter(prefix="/projects", tags=["projects"])

MAX_DATA_BYTES = 6_000_000
KINDS = ("generated", "upload")


def _max_projects() -> int:
    try:
        return max(1, int(os.getenv("MAX_PROJECTS_PER_USER", "100")))
    except ValueError:
        return 100


def _summary(kind: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Facts for the dashboard card, computed from the stored plan (never typed in by the client)."""
    plan = data.get("plan") if isinstance(data.get("plan"), dict) else None
    if plan is None and isinstance(data.get("plans"), list) and data["plans"] and isinstance(data["plans"][0], dict):
        plan = data["plans"][0]
    out: Dict[str, Any] = {}
    if not plan:
        return out
    floors = plan.get("floors") if isinstance(plan.get("floors"), list) else []
    out["floors"] = len(floors)
    out["rooms"] = sum(len((f.get("layout") or {}).get("rooms") or []) for f in floors if isinstance(f, dict))
    plot = ((floors[0].get("layout") or {}).get("plot") if floors and isinstance(floors[0], dict) else None) or {}
    if isinstance(plot.get("width"), (int, float)) and isinstance(plot.get("length"), (int, float)):
        out["plot"] = f"{plot['width']:.0f} x {plot['length']:.0f} ft"
    if isinstance(plan.get("building_type"), str):
        out["building_type"] = plan["building_type"][:20]
    out["source"] = "uploaded plan" if kind == "upload" else "generated"
    rooms = ((floors[0].get("layout") or {}).get("rooms") or []) if floors and isinstance(floors[0], dict) else []
    thumb = []
    for r in rooms[:40]:
        if isinstance(r, dict) and all(isinstance(r.get(k), (int, float)) for k in ("x", "y", "width", "length")):
            thumb.append([str(r.get("room_type", ""))[:24], round(r["x"], 1), round(r["y"], 1), round(r["width"], 1), round(r["length"], 1)])
    if thumb and "plot" in out:
        out["thumb"] = {"w": round(plot["width"], 1), "l": round(plot["length"], 1), "rooms": thumb}
    return out


def _row(p: Project, full: bool = False) -> Dict[str, Any]:
    out = {"id": p.id, "name": p.name, "kind": p.kind, "style": p.style, "summary": json.loads(p.summary or "{}"),
           "created_at": p.created_at.isoformat() + "Z", "updated_at": p.updated_at.isoformat() + "Z"}
    if full:
        out["data"] = json.loads(p.data or "{}")
    return out


def _clean_name(v: Any) -> str:
    t = " ".join("".join(ch for ch in str(v or "") if ch.isprintable() and ch not in "<>").split())[:120]
    if not t:
        raise HTTPException(status_code=422, detail="Give the project a name.")
    return t


def _data(v: Any) -> Dict[str, Any]:
    if not isinstance(v, dict):
        raise HTTPException(status_code=422, detail="The project has no design to save.")
    if len(json.dumps(v, default=str)) > MAX_DATA_BYTES:
        raise HTTPException(status_code=413, detail="This project is too large to save.")
    plan = v.get("plan")
    plans = v.get("plans")
    if not (isinstance(plan, dict) and isinstance(plan.get("floors"), list)) and not (isinstance(plans, list) and plans):
        raise HTTPException(status_code=422, detail="Only a generated or uploaded plan can be saved.")
    return v


def _get(db: Session, user: User, pid: int) -> Project:
    p = db.query(Project).filter(Project.id == pid, Project.user_id == user.id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Project not found.")
    return p


@router.get("")
def list_projects(limit: int = 50, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> List[Dict[str, Any]]:
    rows = db.query(Project).filter(Project.user_id == user.id).order_by(Project.updated_at.desc(), Project.id.desc()).limit(max(1, min(limit, 100))).all()
    return [_row(p) for p in rows]


@router.post("", status_code=201)
def create_project(body: Dict[str, Any], db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    kind = body.get("kind") if body.get("kind") in KINDS else "generated"
    data = _data(body.get("data"))
    if db.query(Project).filter(Project.user_id == user.id).count() >= _max_projects():
        raise HTTPException(status_code=409, detail=f"You have reached the limit of {_max_projects()} saved projects. Delete one to save another.")
    p = Project(user_id=user.id, name=_clean_name(body.get("name")), kind=kind, style=canonical_style(body.get("style")),
                summary=json.dumps(_summary(kind, data)), data=json.dumps(data), created_at=datetime.utcnow(), updated_at=datetime.utcnow())
    db.add(p)
    db.commit()
    db.refresh(p)
    return _row(p, full=True)


@router.get("/{pid}")
def get_project(pid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _row(_get(db, user, pid), full=True)


@router.put("/{pid}")
def update_project(pid: int, body: Dict[str, Any], db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = _get(db, user, pid)
    if "name" in body:
        p.name = _clean_name(body.get("name"))
    if "style" in body:
        p.style = canonical_style(body.get("style"))
    if "data" in body:
        data = _data(body.get("data"))
        p.data = json.dumps(data)
        p.summary = json.dumps(_summary(p.kind, data))
    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return _row(p, full=True)


@router.delete("/{pid}", status_code=204)
def delete_project(pid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.delete(_get(db, user, pid))
    db.commit()
    return Response(status_code=204)
