"""Gemini's answer -> a clean, bounded `reading`.  Gemini's output is untrusted: every number is clamped, every enum checked, text is
shortened and stripped of control characters, duplicates are dropped, and nothing here adds anything that Gemini did not report."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from backend.planimport.gemini import CONFIDENCE, PROVENANCE, ROOM_TYPES
from backend.planimport.validate import ImageInfo

MAX_ROOMS, MAX_DOORS, MAX_WINDOWS, MAX_CLUES, MAX_UNKNOWN = 40, 60, 80, 30, 20
MIN_BOX_UNITS = 12.0            # a room box narrower than 1.2 % of the image is noise
_CTRL = re.compile(r"[\x00-\x1f\x7f<>]")


def _txt(v: Any, n: int = 80) -> Optional[str]:
    if not isinstance(v, str):
        return None
    t = _CTRL.sub(" ", v).strip()
    t = " ".join(t.split())
    return t[:n] or None


def _num(v: Any, lo: float, hi: float) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if lo <= f <= hi and f == f else None


def _box(b: Any) -> Optional[Dict[str, float]]:
    if not isinstance(b, dict):
        return None
    vals = [_num(b.get(k), -50, 1050) for k in ("xmin", "ymin", "xmax", "ymax")]
    if any(v is None for v in vals):
        return None
    x0, y0, x1, y1 = (min(1000.0, max(0.0, v)) for v in vals)
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    return {"x0": round(x0, 1), "y0": round(y0, 1), "x1": round(x1, 1), "y1": round(y1, 1)}


def _pt(p: Any) -> Optional[Dict[str, float]]:
    if not isinstance(p, dict):
        return None
    x, y = _num(p.get("x"), -50, 1050), _num(p.get("y"), -50, 1050)
    if x is None or y is None:
        return None
    return {"x": round(min(1000.0, max(0.0, x)), 1), "y": round(min(1000.0, max(0.0, y)), 1)}


def _iou(a: Dict[str, float], b: Dict[str, float]) -> float:
    w = min(a["x1"], b["x1"]) - max(a["x0"], b["x0"])
    h = min(a["y1"], b["y1"]) - max(a["y0"], b["y0"])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    ua = (a["x1"] - a["x0"]) * (a["y1"] - a["y0"]) + (b["x1"] - b["x0"]) * (b["y1"] - b["y0"]) - inter
    return inter / ua if ua > 0 else 0.0


def normalise_reading(raw: Dict[str, Any], info: ImageInfo, model: str = "") -> Dict[str, Any]:
    notes: List[str] = []
    rank = {"high": 0, "medium": 1, "low": 2}
    rooms: List[Dict[str, Any]] = []
    for r in (raw.get("rooms") or [])[: MAX_ROOMS * 2]:
        if not isinstance(r, dict):
            continue
        box = _box(r.get("box"))
        if not box or box["x1"] - box["x0"] < MIN_BOX_UNITS or box["y1"] - box["y0"] < MIN_BOX_UNITS:
            notes.append("A room outline that was too small or unreadable was left out.")
            continue
        rtype = r.get("room_type") if r.get("room_type") in ROOM_TYPES else "other"
        shape = r.get("shape") if r.get("shape") in ("rectangular", "l_shaped", "irregular") else "irregular"
        rooms.append({
            "label": _txt(r.get("label_text"), 40), "room_type": rtype, "box": box, "shape": shape,
            "dimension_text": _txt(r.get("dimension_text"), 40),
            "width_ft": _num(r.get("width_ft"), 2, 200), "length_ft": _num(r.get("length_ft"), 2, 200),
            "provenance": r.get("provenance") if r.get("provenance") in PROVENANCE else "inferred",
            "confidence": r.get("confidence") if r.get("confidence") in CONFIDENCE else "low",
        })
    kept: List[Dict[str, Any]] = []
    for r in sorted(rooms, key=lambda q: rank[q["confidence"]]):         # best first; a near-duplicate box of a worse room is dropped
        if any(_iou(r["box"], k["box"]) > 0.6 for k in kept):
            notes.append("Two overlapping outlines for the same room were merged into the more confident one.")
            continue
        kept.append(r)
    kept = kept[:MAX_ROOMS]
    kept.sort(key=lambda q: (round(q["box"]["y0"] / 40), q["box"]["x0"]))
    for i, r in enumerate(kept, 1):
        r["id"] = f"r{i}"
    out_doors, out_windows = [], []
    for kind, lst, cap, dst in (("door", raw.get("doors"), MAX_DOORS, out_doors), ("window", raw.get("windows"), MAX_WINDOWS, out_windows)):
        for d in (lst or [])[:cap]:
            if not isinstance(d, dict):
                continue
            p = _pt(d.get("at"))
            if not p:
                continue
            item = {"id": f"{kind[0]}{len(dst) + 1}", "at": p, "width_ft": _num(d.get("width_ft"), 1, 20),
                    "provenance": d.get("provenance") if d.get("provenance") in PROVENANCE else "inferred",
                    "confidence": d.get("confidence") if d.get("confidence") in CONFIDENCE else "low"}
            if kind == "door":
                item["is_main_entrance"] = bool(d.get("is_main_entrance"))
            dst.append(item)
    clues = []
    for c in (raw.get("scale_clues") or [])[:MAX_CLUES]:
        if isinstance(c, dict) and _txt(c.get("text"), 60):
            clues.append({"text": _txt(c.get("text"), 60), "kind": c.get("kind") if c.get("kind") in
                          ("overall_width", "overall_length", "room_dimension", "scale_bar", "scale_note", "other") else "other",
                          "feet": _num(c.get("feet"), 1, 400), "box": _box(c.get("box"))})
    unknown = [t for t in (_txt(u, 200) for u in (raw.get("unknown") or [])[:MAX_UNKNOWN]) if t]
    for r in kept:
        if r["shape"] != "rectangular":
            notes.append(f"{r['label'] or r['room_type']}: the outline is {r['shape'].replace('_', '-')}; the model supports rectangular rooms, so its bounding box is used.")
    is_plan = bool(raw.get("is_floor_plan"))
    if not is_plan:
        notes.append("Gemini does not think this image is a floor plan.")
    if raw.get("legible") is False:
        notes.append("Gemini reports the drawing is hard to read; check everything carefully.")
    ndir = raw.get("north_arrow_direction")
    return {
        "image": {"width": info.width, "height": info.height, "mime": info.mime, "bytes": info.size},
        "model": model, "is_floor_plan": is_plan, "legible": raw.get("legible") is not False,
        "floor_label": _txt(raw.get("floor_label"), 60), "north": ndir if ndir in ("up", "down", "left", "right") else None,
        "rooms": kept, "doors": out_doors, "windows": out_windows, "scale_clues": clues, "unknown": unknown,
        "notes": list(dict.fromkeys(notes)),
    }


def empty_reading(info: ImageInfo) -> Dict[str, Any]:
    """A reading with nothing detected: the user adds rooms by hand (used when no Gemini key is configured)."""
    return {"image": {"width": info.width, "height": info.height, "mime": info.mime, "bytes": info.size}, "model": "", "is_floor_plan": True,
            "legible": True, "floor_label": None, "north": None, "rooms": [], "doors": [], "windows": [], "scale_clues": [],
            "unknown": ["Nothing was read automatically: add the rooms yourself."], "notes": []}


def clean_reading(obj: Any) -> Dict[str, Any]:
    """The client returns the reading it got from /analyze; re-validate it (it is the same bounded structure, never trusted)."""
    from backend.planimport.build import DraftError
    if not isinstance(obj, dict) or not isinstance(obj.get("image"), dict):
        raise DraftError("bad_reading", "The reading is missing; analyse the image again.")
    img = obj["image"]
    try:
        info = ImageInfo(mime=str(img.get("mime", "image/png")), width=int(img["width"]), height=int(img["height"]), size=int(img.get("bytes", 0)))
    except (KeyError, TypeError, ValueError):
        raise DraftError("bad_reading", "The reading is malformed; analyse the image again.")
    if not (200 <= info.width <= 20000 and 200 <= info.height <= 20000):
        raise DraftError("bad_reading", "The image size in the reading is not valid.")

    def back(b: Any) -> Any:
        return {"xmin": b.get("x0"), "ymin": b.get("y0"), "xmax": b.get("x1"), "ymax": b.get("y1")} if isinstance(b, dict) else None
    raw = {
        "is_floor_plan": obj.get("is_floor_plan", True), "legible": obj.get("legible", True), "floor_label": obj.get("floor_label"),
        "north_arrow_direction": obj.get("north"),
        "rooms": [{"label_text": r.get("label"), "room_type": r.get("room_type"), "box": back(r.get("box")), "shape": r.get("shape"),
                   "dimension_text": r.get("dimension_text"), "width_ft": r.get("width_ft"), "length_ft": r.get("length_ft"),
                   "provenance": r.get("provenance"), "confidence": r.get("confidence")} for r in (obj.get("rooms") or []) if isinstance(r, dict)],
        "doors": [{"at": d.get("at"), "is_main_entrance": d.get("is_main_entrance"), "width_ft": d.get("width_ft"), "provenance": d.get("provenance"),
                   "confidence": d.get("confidence")} for d in (obj.get("doors") or []) if isinstance(d, dict)],
        "windows": [{"at": d.get("at"), "width_ft": d.get("width_ft"), "provenance": d.get("provenance"), "confidence": d.get("confidence")}
                    for d in (obj.get("windows") or []) if isinstance(d, dict)],
        "scale_clues": [{"text": c.get("text"), "kind": c.get("kind"), "feet": c.get("feet"), "box": back(c.get("box"))}
                        for c in (obj.get("scale_clues") or []) if isinstance(c, dict)],
        "unknown": obj.get("unknown") if isinstance(obj.get("unknown"), list) else [],
    }
    out = normalise_reading(raw, info, model=_txt(obj.get("model"), 60) or "")
    # normalise_reading re-numbers rooms by position, which is what the client's ids came from when nothing was edited
    return out
