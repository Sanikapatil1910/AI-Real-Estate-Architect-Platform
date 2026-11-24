"""Turn a plain-language brief into the planner's form fields.

Rule-based on purpose: it works offline, is deterministic and never invents values.
Anything it could not read is reported in ``unparsed`` / ``notes`` instead of being guessed.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

_NUM = r"(\d+(?:\.\d+)?)"
_FT = 3.28084
_WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "single": 1, "double": 2}
_SIDES = {"north": "North", "south": "South", "east": "East", "west": "West"}


def _num_word(tok: str) -> int | None:
    tok = tok.lower()
    return int(tok) if tok.isdigit() else _WORD_NUM.get(tok)


def parse_brief(text: str) -> Dict[str, Any]:
    t = " ".join((text or "").lower().replace("×", "x").replace("*", "x").split())
    out: Dict[str, Any] = {}
    notes: List[str] = []
    seen: List[str] = []

    # plot size: "30x40", "30 x 40 ft", "30 by 40", "9 x 12 m"
    m = re.search(rf"{_NUM}\s*(?:x|by)\s*{_NUM}\s*(ft|feet|foot|m|meter|meters|metre|metres|sq)?", t)
    if m:
        w, l, unit = float(m.group(1)), float(m.group(2)), (m.group(3) or "")
        if unit in {"m", "meter", "meters", "metre", "metres"}:
            out["unit"] = "Meters"
        else:
            out["unit"] = "Feet"
        out["plot_width"], out["plot_length"] = w, l
        seen.append("plot size")
    else:
        m = re.search(rf"{_NUM}\s*(?:sq\.?\s*ft|sqft|square feet|sq\.?\s*m)\b", t)
        if m:
            notes.append("A plot area was given without width and length; please enter both dimensions.")

    # road side
    m = re.search(r"(north|south|east|west)\s*(?:-|\s)?(?:facing|side road|road|side)", t) or \
        re.search(r"road\s*(?:is\s*)?(?:on|to|towards|from)?\s*(?:the\s*)?(north|south|east|west)", t)
    if m:
        out["road_side"] = _SIDES[m.group(1)]
        seen.append("road side")

    # BHK / bedrooms
    m = re.search(r"(\d)\s*-?\s*bhk", t) or re.search(r"\b(one|two|three|four|five)\s*-?\s*bhk", t)
    if m:
        n = _num_word(m.group(1))
        if n:
            out["bedrooms"] = n
            out["bathrooms"] = n
            out["house_type"] = f"{n} BHK" if n <= 4 else "Custom"
            seen.append("bedrooms")
    else:
        m = re.search(r"(\d|one|two|three|four|five)\s*(?:bed\s*rooms?|bedrooms?|beds?)\b", t)
        if m:
            n = _num_word(m.group(1))
            if n:
                out["bedrooms"] = n
                out["bathrooms"] = n
                out["house_type"] = f"{n} BHK" if n <= 4 else "Custom"
                seen.append("bedrooms")
    m = re.search(r"(\d|one|two|three|four|five)\s*(?:bath\s*rooms?|bathrooms?|baths?|toilets?)\b", t)
    if m and _num_word(m.group(1)):
        out["bathrooms"] = _num_word(m.group(1))

    # floors
    if re.search(r"\bg\s*\+\s*2\b|\bg2\b|three[- ]stor(?:e)?y|3[- ]stor(?:e)?y|two floors above|triplex", t):
        out["building_type"] = "G+2"
    elif re.search(r"\bg\s*\+\s*1\b|\bg1\b|two[- ]stor(?:e)?y|2[- ]stor(?:e)?y|double[- ]stor(?:e)?y|first floor|duplex|1st floor", t):
        out["building_type"] = "Duplex" if "duplex" in t else "G+1"
    elif re.search(r"\bvilla\b|bungalow", t):
        out["building_type"] = "Villa" if "villa" in t else "G+1"
    elif re.search(r"ground[- ]floor only|single[- ]stor(?:e)?y|one[- ]stor(?:e)?y|only ground|\bground\b", t):
        out["building_type"] = "Ground"
    if "building_type" in out:
        seen.append("floors")

    # parking
    if re.search(r"no parking|without parking", t):
        out["parking"] = "No Parking"
    else:
        m = re.search(r"(\d|one|two|single|double)?\s*(?:car\s*)?(?:parking|garage|car park)|(\d|one|two)\s*cars?\b", t)
        if m:
            n = _num_word(m.group(1) or m.group(2) or "one") or 1
            bikes = re.search(r"bike|scooter|two[- ]wheeler", t)
            out["parking"] = "Car + Bikes" if (bikes and n >= 1 and "car" in t) else ("2 Cars" if n >= 2 else "1 Car")
        elif re.search(r"bike|scooter|two[- ]wheeler", t):
            out["parking"] = "Bikes"
    if "parking" in out:
        seen.append("parking")

    # Vastu
    if re.search(r"strict(?:ly)? vastu|vastu strict|100% vastu|fully vastu", t):
        out["vastu_mode"] = "Strict"
    elif re.search(r"no vastu|ignore vastu|without vastu|vastu not required", t):
        out["vastu_mode"] = "No Preference"
    elif "vastu" in t:
        out["vastu_mode"] = "Basic"
    if "vastu_mode" in out:
        seen.append("vastu")

    # optional rooms (explicit mentions only)
    def flag(key, pos, neg=None):
        if neg and re.search(neg, t):
            out[key] = False
        elif re.search(pos, t):
            out[key] = True
    flag("puja", r"puja|pooja|prayer|mandir|temple room", r"no (?:puja|pooja)|without (?:puja|pooja)")
    flag("utility", r"utility|wash area|laundry", r"no utility|without utility")
    flag("dining", r"dining", r"no dining|without dining")
    flag("guest", r"guest (?:bed)?room|guest room", r"no guest")
    flag("balcony", r"balcon", r"no balcon|without balcon")
    flag("garden", r"garden|lawn", r"no garden|without garden")
    m = re.search(r"(open|closed|modular|traditional)\s+kitchen", t)
    if m:
        out["kitchen_type"] = m.group(1).capitalize()
    if "study" in t or "home office" in t:
        notes.append("A study/home office was mentioned; add it as a bedroom or request it explicitly if needed.")

    if not out:
        notes.append("I could not find any plot size, BHK, floors or road side in that text.")
    elif "plot_width" not in out:
        notes.append("No plot size found (try e.g. '30x40 ft').")
    return {"fields": out, "understood": seen, "notes": notes}
