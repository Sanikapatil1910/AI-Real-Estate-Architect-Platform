"""The three architectural styles in the backend, the schema, the requirement parser and the shipped sources.

* exactly Modern Minimalistic, Traditional Indian and Maharashtrian Wada exist; every stored / requested name maps onto one of them,
* the planning geometry does not depend on the style (the style only dresses the validated plan),
* the removed styles are gone from the selector and the data (no profile files, no selectable names).
"""
import re
import unittest
from pathlib import Path

from backend.ai.requirement_parser import parse_requirements
from backend.planner.architect.service import generate
from backend.planner.style_knowledge import (
    LEGACY_STYLE_MAP, MODERN_STYLE, SUPPORTED_STYLES, TRADITIONAL_STYLE, WADA_STYLE, canonical_style, style_design_notes, get_style_profile, load_style_profiles,
)
from backend.schemas import GenerateRequest as PlanRequest

ROOT = Path(__file__).resolve().parents[1]
REMOVED = ["Minimalistic Luxury", "Contemporary Indian", "Modern Indian", "Traditional Maharashtrian", "South Indian Traditional"]


def payload(style):
    rooms = [{"room_type": t} for t in ["living_room", "dining", "kitchen", "utility", "master_bedroom", "bedroom", "bedroom", "bathroom", "bathroom", "bathroom"]]
    return dict(plot_width=30, plot_length=45, road_side="South", building_type="G+1", rooms=rooms, vastu_mode="basic", balcony_required=True,
                strict=False, architectural_style=style)


def geometry(result):
    out = []
    plan = result["plans"][0] if "plans" in result else result
    for fl in plan["floors"]:
        out.append(sorted((r["room_type"], round(r["x"], 2), round(r["y"], 2), round(r.get("x2", r["x"] + r["width"]), 2), round(r.get("y2", r["y"] + r["length"]), 2))
                          for r in fl["layout"]["rooms"]))
    return out


class StyleNames(unittest.TestCase):
    def test_exactly_three_styles(self):
        self.assertEqual(SUPPORTED_STYLES, ("Modern Minimalistic", "Traditional Indian", "Maharashtrian Wada"))
        self.assertEqual(sorted(p["name"] for p in load_style_profiles().values()), sorted(SUPPORTED_STYLES))

    def test_every_removed_style_maps_to_a_supported_one(self):
        for name in REMOVED:
            self.assertIn(canonical_style(name), SUPPORTED_STYLES, name)
        self.assertEqual(canonical_style("South Indian Traditional"), TRADITIONAL_STYLE)
        self.assertEqual(canonical_style("Traditional Maharashtrian"), TRADITIONAL_STYLE)
        for name in ("Minimalistic Luxury", "Contemporary Indian", "Modern Indian"):
            self.assertEqual(canonical_style(name), MODERN_STYLE)
        for junk in ("", None, "Coastal", "Gothic", 42):
            self.assertEqual(canonical_style(junk), MODERN_STYLE, repr(junk))
        for name in SUPPORTED_STYLES:
            self.assertEqual(canonical_style(name), name)
            self.assertEqual(canonical_style(name.upper()), name)
            self.assertEqual(get_style_profile(name)["name"], name)
        self.assertTrue(set(LEGACY_STYLE_MAP.values()) <= set(SUPPORTED_STYLES))

    def test_wada_is_a_style_of_its_own(self):
        for name in ("Maharashtrian Wada", "maharashtrian wada", "MAHARASHTRIAN_WADA", "wada", "Wada", "a wada style house", "Wada Style"):
            self.assertEqual(canonical_style(name), WADA_STYLE, name)
        # near-misses and the older names are unchanged: Traditional Maharashtrian stays Traditional Indian, "wadala" is not a wada
        self.assertEqual(canonical_style("Traditional Maharashtrian"), TRADITIONAL_STYLE)
        self.assertEqual(canonical_style("nalukettu"), TRADITIONAL_STYLE)
        self.assertEqual(canonical_style("wadala"), MODERN_STYLE)
        prof = get_style_profile(WADA_STYLE)
        self.assertEqual(prof["name"], WADA_STYLE)
        self.assertTrue(prof["courtyard_preference"] and prof["veranda_preference"])
        self.assertNotEqual(prof["material_appearance_hints"], get_style_profile(TRADITIONAL_STYLE)["material_appearance_hints"])
        self.assertTrue(any("courtyard" in n.lower() for n in style_design_notes(WADA_STYLE)))
        self.assertNotEqual(style_design_notes(WADA_STYLE), style_design_notes(TRADITIONAL_STYLE))

    def test_schema_normalises_the_style(self):
        base = dict(plot_width=30, plot_length=40, road_side="South", building_type="Ground", rooms=[{"room_type": "living_room"}])
        for raw, want in (("Traditional Indian", TRADITIONAL_STYLE), ("South Indian Traditional", TRADITIONAL_STYLE), ("Minimalistic Luxury", MODERN_STYLE),
                          ("Whatever", MODERN_STYLE), ("Modern Minimalistic", MODERN_STYLE), ("Maharashtrian Wada", WADA_STYLE), ("wada", WADA_STYLE)):
            self.assertEqual(PlanRequest(**base, architectural_style=raw).architectural_style, want, raw)
        self.assertEqual(PlanRequest(**base).architectural_style, MODERN_STYLE)

    def test_requirement_parser_only_stores_supported_styles(self):
        res = parse_requirements("I have a 40 by 50 north-facing plot. 3 BHK G+1 house, traditional Indian style.")
        self.assertEqual(res["requirements"]["preferences"]["architectural_style"], TRADITIONAL_STYLE)
        res = parse_requirements("I have a 40 by 50 north-facing plot. 3 BHK G+1 house, modern minimalistic style.")
        self.assertEqual(res["requirements"]["preferences"]["architectural_style"], MODERN_STYLE)
        for text in ("Maharashtrian Wada style", "a wada style home"):
            res = parse_requirements(f"I have a 40 by 50 north-facing plot. 3 BHK G+1 house, {text}.")
            self.assertEqual(res["requirements"]["preferences"]["architectural_style"], WADA_STYLE, text)


class StyleNeverMovesTheBuilding(unittest.TestCase):
    """The architect engine is time-budgeted (a loaded machine may pick another equally valid layout), so the geometry guarantee is tested where it is
    deterministic: the engine's source never reads the style, and the plan's contents (floors, rooms per floor) are the same for both styles."""

    def test_engine_sources_never_read_the_style(self):
        arch = ROOT / "backend" / "planner" / "architect"
        pattern = re.compile(r"architectural_style|style_knowledge|get_style_profile|score_layout_style|generate_room_dimensions|STYLE")
        users = {}
        for f in sorted(arch.glob("*.py")):
            hits = [i + 1 for i, line in enumerate(f.read_text().splitlines()) if pattern.search(line) and not line.strip().startswith("#")]
            if hits:
                users[f.name] = hits
        self.assertEqual(sorted(users), ["adapter.py"], f"only the adapter may touch the style (it just echoes the canonical name): {users}")
        self.assertLessEqual(len(users["adapter.py"]), 3)

    def test_same_plan_contents_for_both_styles_and_legacy_names(self):
        def contents(result):
            plan = result["plans"][0]
            # circulation connectors ("passage") come out of a time-budgeted search and can differ with machine load; the programme of rooms cannot
            return plan["architectural_style"], [sorted(r["room_type"] for r in fl["layout"]["rooms"] if r["room_type"] != "passage") for fl in plan["floors"]]
        ref_style, ref = contents(generate(payload(MODERN_STYLE), budget_s=12))
        self.assertEqual(ref_style, MODERN_STYLE)
        self.assertEqual(len(ref), 2)
        for style, want in ((TRADITIONAL_STYLE, TRADITIONAL_STYLE), ("South Indian Traditional", TRADITIONAL_STYLE), (WADA_STYLE, WADA_STYLE)):
            got_style, got = contents(generate(payload(style), budget_s=12))
            self.assertEqual(got, ref, f"{style}: the rooms of every floor do not depend on the style")
            self.assertEqual(got_style, want)


class SourcesAreClean(unittest.TestCase):
    def test_removed_style_files_are_gone(self):
        for sub in ("knowledge/styles", "backend/planner/styles"):
            d = ROOT / sub
            if d.exists():
                names = sorted(p.name for p in d.iterdir() if p.suffix in (".json", ".py") and p.name != "__init__.py")
                self.assertLessEqual(len(names), 3, f"{sub}: {names}")

    def test_frontend_selector_lists_three_styles(self):
        src = (ROOT / "frontend-react" / "src" / "lib" / "archStyle.ts").read_text()
        m = re.search(r"ARCH_STYLES[^=]*=\s*\[([^\]]*)\]", src)
        self.assertEqual(re.findall(r"'([^']+)'", m.group(1)), ["Modern Minimalistic", "Traditional Indian", "Maharashtrian Wada"])
        types = (ROOT / "frontend-react" / "src" / "types" / "index.ts").read_text()
        m = re.search(r"type ArchitecturalStyle\s*=([^\n]+(?:\n\s*\|[^\n]+)*)", types)
        self.assertEqual(re.findall(r"'([^']+)'", m.group(1)), ["Modern Minimalistic", "Traditional Indian", "Maharashtrian Wada"])

    def test_streamlit_selector_lists_three_styles(self):
        src = (ROOT / "frontend" / "app.py").read_text()
        for name in REMOVED:
            self.assertNotIn(f'"{name}"', src, f"{name} is still offered in the Streamlit front end")


if __name__ == "__main__":
    unittest.main()
