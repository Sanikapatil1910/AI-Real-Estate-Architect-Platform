import unittest
from backend.planner.brief_parser import parse_brief


class BriefParserTests(unittest.TestCase):
    def test_full_brief(self):
        f = parse_brief("3BHK house on a 30x40 ft plot, south facing road, G+1, one car parking, basic vastu, with puja room and balcony")["fields"]
        self.assertEqual((f["plot_width"], f["plot_length"], f["unit"]), (30.0, 40.0, "Feet"))
        self.assertEqual((f["road_side"], f["bedrooms"], f["house_type"]), ("South", 3, "3 BHK"))
        self.assertEqual((f["building_type"], f["parking"], f["vastu_mode"]), ("G+1", "1 Car", "Basic"))
        self.assertTrue(f["puja"] and f["balcony"])

    def test_meters_and_negatives(self):
        f = parse_brief("2 bhk 9 x 12 m plot, east side road, ground floor only, no parking, no vastu, without dining")["fields"]
        self.assertEqual((f["unit"], f["plot_width"]), ("Meters", 9.0))
        self.assertEqual((f["road_side"], f["building_type"], f["parking"]), ("East", "Ground", "No Parking"))
        self.assertEqual(f["vastu_mode"], "No Preference")
        self.assertFalse(f["dining"])

    def test_nothing_is_invented(self):
        r = parse_brief("make me something nice")
        self.assertEqual(r["fields"], {})
        self.assertTrue(r["notes"])

    def test_endpoint(self):
        from fastapi.testclient import TestClient
        from backend.main import app
        r = TestClient(app).post("/parse-brief", json={"text": "four bhk 40x60 north road G+2 2 cars strict vastu"})
        f = r.json()["fields"]
        self.assertEqual((f["bedrooms"], f["building_type"], f["parking"], f["vastu_mode"]), (4, "G+2", "2 Cars", "Strict"))


if __name__ == "__main__":
    unittest.main()


class LlmBriefTests(unittest.TestCase):
    def test_gemini_values_are_validated_and_merged(self):
        from backend.planner.llm_brief import parse_brief_smart
        raw = {"plot_width": 12, "plot_length": 15, "unit": "Meters", "road_side": "Up",
               "bedrooms": 99, "building_type": "G+1", "parking": "2 Cars",
               "puja": True, "notes": ["wants a home theatre"]}
        r = parse_brief_smart("a lovely home for my parents, 12 by 15 metres, two cars", lambda t: raw)
        f = r["fields"]
        self.assertEqual(r["source"], "gemini")
        self.assertEqual((f["plot_width"], f["unit"], f["building_type"], f["parking"]), (12, "Meters", "G+1", "2 Cars"))
        self.assertNotIn("road_side", f)            # invalid enum rejected
        self.assertNotIn("bedrooms", f)             # out of range rejected
        self.assertIn("wants a home theatre", r["notes"])

    def test_implausible_plot_is_dropped(self):
        from backend.planner.llm_brief import parse_brief_smart
        r = parse_brief_smart("x", lambda t: {"plot_width": 3, "plot_length": 4000})
        self.assertNotIn("plot_width", r["fields"])

    def test_falls_back_to_rules_on_error(self):
        from backend.planner.llm_brief import GeminiError, parse_brief_smart
        def boom(t): raise GeminiError(429, "quota")
        r = parse_brief_smart("3BHK 30x40 south road", boom)
        self.assertEqual(r["source"], "rules")
        self.assertEqual(r["fields"]["bedrooms"], 3)
        self.assertTrue(any("Free-tier" in n for n in r["notes"]))

    def test_no_key_means_rules(self):
        import os
        from backend.planner.llm_brief import llm_available, parse_brief_smart
        saved = {k: os.environ.pop(k, None) for k in ("GEMINI_API_KEY", "GOOGLE_API_KEY")}
        try:
            self.assertFalse(llm_available())
            self.assertEqual(parse_brief_smart("2bhk 20x30")["source"], "rules")
        finally:
            for k, v in saved.items():
                if v: os.environ[k] = v

    def test_request_shape_and_model_fallback(self):
        import os
        from backend.planner import llm_brief as lb
        os.environ["GEMINI_API_KEY"] = "test-key"
        os.environ.pop("GEMINI_MODEL", None)
        calls = []
        def fake_post(model, body, key, timeout=20.0):
            calls.append((model, key, body))
            if model == lb.DEFAULT_MODELS[0]:
                raise lb.GeminiError(404, "model not found")
            return {"candidates": [{"content": {"parts": [{"text": '{"bedrooms": 2, "unit": "Feet"}'}]}}]}
        try:
            obj = lb.call_gemini("2bhk", post=fake_post)
        finally:
            os.environ.pop("GEMINI_API_KEY")
        self.assertEqual(obj["bedrooms"], 2)
        self.assertEqual([c[0] for c in calls], lb.DEFAULT_MODELS[:2])      # fell through to the second model
        body = calls[0][2]
        self.assertEqual(body["generationConfig"]["responseMimeType"], "application/json")
        self.assertIn("<brief>", body["contents"][0]["parts"][0]["text"])
        self.assertEqual(calls[0][1], "test-key")

    def test_bad_key_is_not_retried(self):
        import os
        from backend.planner import llm_brief as lb
        os.environ["GEMINI_API_KEY"] = "bad"
        n = []
        def fake_post(model, body, key, timeout=20.0):
            n.append(model); raise lb.GeminiError(403, "API key not valid")
        try:
            with self.assertRaises(lb.GeminiError):
                lb.call_gemini("x", post=fake_post)
        finally:
            os.environ.pop("GEMINI_API_KEY")
        self.assertEqual(len(n), 1)
