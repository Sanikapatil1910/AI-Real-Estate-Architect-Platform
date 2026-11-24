import unittest

from backend.planner.critique import critique_plans, fact_sheet
from backend.planner.llm_brief import GeminiError
from backend.planner.architect.service import generate


def _rooms():
    t = ["living_room", "dining", "kitchen", "utility", "master_bedroom", "bedroom", "bedroom",
         "bathroom", "bathroom", "bathroom"]
    return [{"room_type": x} for x in t]


class CritiqueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plans = generate(dict(plot_width=30, plot_length=40, road_side="South", building_type="G+1",
                                  rooms=_rooms(), vastu_mode="basic", balcony_required=True), budget_s=10)["plans"]

    def test_fact_sheet_is_measured(self):
        f = fact_sheet(self.plans[0])
        self.assertEqual(f["bedrooms"], 3)
        self.assertGreaterEqual(f["bathrooms"], 3)   # + the compulsory common bath
        self.assertGreater(f["built_up_sqft"], 1000)
        self.assertTrue(0 <= f["corridor_share_pct"] < 40)
        self.assertEqual(f["plan_number"], self.plans[0]["plan_number"])

    def test_rule_critique_covers_every_plan_and_picks_one(self):
        r = critique_plans(self.plans)
        self.assertEqual(r["source"], "rules")
        nums = [p["plan_number"] for p in self.plans]
        self.assertEqual(sorted(p["plan_number"] for p in r["plans"]), sorted(nums))
        self.assertIn(r["pick"]["plan_number"], nums)
        self.assertEqual(sorted(p["rank"] for p in r["plans"]), list(range(1, len(nums) + 1)))
        self.assertTrue(r["pick"]["reason"])

    def test_gemini_text_is_validated(self):
        nums = [p["plan_number"] for p in self.plans]
        seen = {}
        def fake(body):
            seen["body"] = body
            return {"overview": "Four options.", "pick": {"plan_number": nums[1], "reason": "Best light."},
                    "plans": [{"plan_number": n, "headline": f"Plan {n}", "strengths": ["a", "b", "c", "d"],
                               "concerns": ["x"], "best_for": "families"} for n in nums]}
        r = critique_plans(self.plans, "family with elders", caller=fake)
        self.assertEqual(r["source"], "gemini")
        self.assertEqual(r["pick"]["plan_number"], nums[1])
        self.assertTrue(all(len(p["strengths"]) <= 3 for p in r["plans"]))
        self.assertIn("<facts>", seen["body"]["contents"][0]["parts"][0]["text"])

    def test_bad_gemini_answers_fall_back(self):
        nums = [p["plan_number"] for p in self.plans]
        r = critique_plans(self.plans, caller=lambda b: {"plans": [{"plan_number": nums[0], "headline": "x",
                                                                      "strengths": [], "concerns": []}],
                                                         "pick": {"plan_number": 99, "reason": "?"}, "overview": ""})
        self.assertEqual(r["source"], "rules")
        self.assertIn("unusable", r["note"])

        def quota(b): raise GeminiError(429, "quota")
        r2 = critique_plans(self.plans, caller=quota)
        self.assertEqual(r2["source"], "rules")
        self.assertIn("Free-tier", r2["note"])

    def test_pick_must_exist(self):
        nums = [p["plan_number"] for p in self.plans]
        r = critique_plans(self.plans, caller=lambda b: {
            "overview": "o", "pick": {"plan_number": 99, "reason": "bogus"},
            "plans": [{"plan_number": n, "headline": "h", "strengths": ["s"], "concerns": []} for n in nums]})
        self.assertIn(r["pick"]["plan_number"], nums)

    def test_endpoint(self):
        from fastapi.testclient import TestClient
        from backend.main import app
        c = TestClient(app)
        r = c.post("/critique", json={"plans": self.plans})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["plans"]), len(self.plans))
        self.assertEqual(c.post("/critique", json={"plans": []}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
