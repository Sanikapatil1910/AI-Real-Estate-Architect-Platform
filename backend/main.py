import os
import sys
from pathlib import Path
from typing import Any, Dict

_proj = Path(__file__).resolve().parents[1]
_local_deps = _proj / "_pydeps"
if _local_deps.exists():
    sys.path.insert(0, str(_local_deps))

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from backend.database import Base, engine
from backend.planner.multi_floor_multi_layout import generate_project_plans
from backend.planner.plot_rules import create_plot
from backend.routers.auth import router as auth_router
from backend.routers.plan_import import router as plan_import_router
from backend.routers.projects import router as projects_router
from backend.schemas import GenerateRequest
from backend.planner.architect.feasibility import check_request
from backend.planner.architect.service import Infeasible, NoLayout, generate as architect_generate

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="AI Real Estate Architect Platform",
    version="2.0.0",
    description="Constraint-based architectural planning API with Vastu, road, multi-floor and explainable analysis.",
)


origins_env = os.getenv("CORS_ORIGINS", "")
if origins_env:
    origins = [o.strip() for o in origins_env.split(",") if o.strip()]
else:
    origins = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(plan_import_router)
app.include_router(projects_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "AI Real Estate Architect"}


@app.post("/parse-brief")
def parse_brief_endpoint(body: Dict[str, Any]):
    """Plain-language brief -> form fields (rule based, no external service)."""
    from backend.planner.llm_brief import parse_brief_smart
    return parse_brief_smart(str(body.get("text", "")))


@app.post("/critique")
def critique_endpoint(body: Dict[str, Any]):
    """Measured comparison of generated plans, worded by Gemini when a key is set."""
    from backend.planner.critique import critique_plans
    plans = body.get("plans") or []
    if not isinstance(plans, list) or not plans:
        raise HTTPException(status_code=422, detail="Send the generated plans in 'plans'.")
    try:
        return critique_plans(plans, str(body.get("brief", "")))
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"Could not read the plans: {exc}")


@app.get("/parse-brief/status")
def parse_brief_status():
    from backend.planner.llm_brief import _models, llm_available
    return {"llm": llm_available(), "provider": "gemini", "models": _models()}


@app.post("/feasibility")
def feasibility(payload: Dict[str, Any]):
    try:
        return check_request(payload, suggest=True)
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.post("/diagnose")
def diagnose_brief(payload: Dict[str, Any]):
    """Transparent constraint report for a brief (no layout is searched): buildable footprint, per-floor area, parking, stair, what is mandatory
    and which preferences could be traded with the user's approval."""
    from backend.planner.architect.diagnostics import diagnose
    try:
        return diagnose(dict(payload))
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.post("/adjustments")
def adjustments(payload: Dict[str, Any]):
    """Specific changes the planner proposes for a brief it could not plan, each with its reason.  Nothing is applied: the client sends the ids the
    user approved back to /generate as `approved_adjustments`."""
    from backend.planner.architect.diagnostics import propose_adjustments
    verify = payload.pop("verify", True)
    try:
        return propose_adjustments(dict(payload), verify=bool(verify))
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _run_architect(payload: Dict[str, Any]):
    payload = dict(payload)
    payload.setdefault("road_side", "North")
    try:
        return architect_generate(payload)
    except Infeasible as exc:
        from backend.planner.architect.diagnostics import diagnose
        raise HTTPException(status_code=422, detail={"message": str(exc), "feasibility": exc.report, "status": "conflict",
                                                    "conflicts": [{"code": "AREA", "message": m} for m in exc.report.get("errors", [])],
                                                    "verdict": "infeasible",
                                                    "outcome": diagnose(payload, verdict="infeasible")["outcome"],
                                                    "diagnostic": diagnose(payload, verdict="infeasible"),
                                                    "closest_available": True})
    except NoLayout as exc:
        raise HTTPException(status_code=422, detail={"message": exc.message, "feasibility": exc.report, "conflicts": exc.conflicts,
                                                    "status": "conflict", "verdict": exc.verdict, "outcome": (exc.diagnostic or {}).get("outcome", exc.verdict),
                                                    "diagnostic": exc.diagnostic, "closest_available": True})
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _run_generate(payload: Dict[str, Any]):
    """Every request is planned by the architect engine.  The old placer ("engine": "legacy") was retired: it ignored the setbacks and the
    circulation rules and no longer worked, so a request that still asks for it is answered by the architect engine and says so."""
    wanted = str(payload.get("engine", "architect")).lower()
    res = _run_architect(payload)
    if wanted == "legacy" and isinstance(res, dict):
        res = dict(res)
        res["engine_note"] = "The legacy engine has been retired; this plan was produced by the architect engine."
        res["warnings"] = list(res.get("warnings", [])) + [res["engine_note"]]
    return res


@app.post("/generate")
def generate(payload: GenerateRequest):
    return _run_generate(payload.to_payload())


@app.post("/generate/raw")
def generate_raw(payload: Dict[str, Any]):
    return _run_generate(payload)
