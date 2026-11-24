import unittest

from backend.ai.requirement_parser import parse_requirements
from backend.ai.requirement_summary import (
    build_clarification_questions,
    summarize_requirements,
)


class RequirementSummaryTests(unittest.TestCase):
    COMPLETE = (
        "I have a 40 by 50 north-facing plot. I want a 3 BHK G+1 house "
        "for a family of four. I want strict Vastu, traditional Maharashtrian "
        "style and hot and humid climate with high ventilation."
    )

    def test_complete_summary_is_ready(self):
        result = summarize_requirements(parse_requirements(self.COMPLETE))
        self.assertEqual(result["summary"]["plot"], "40 × 50 ft")
        self.assertEqual(result["summary"]["road"], "North")
        self.assertEqual(result["summary"]["bedrooms"], 3)
        self.assertEqual(result["summary"]["building_type"], "G+1")
        self.assertEqual(result["summary"]["vastu"], "Strict")
        self.assertEqual(result["summary"]["style"], "Traditional Indian")
        self.assertEqual(result["summary"]["climate"], "Hot & Humid")
        self.assertTrue(result["ready_for_planning"])

    def test_missing_plot_dimensions_and_building_type(self):
        result = summarize_requirements(parse_requirements("I want a 3 BHK north-facing house."))
        self.assertFalse(result["ready_for_planning"])
        self.assertIn("plot dimensions", result["missing"])
        self.assertIn("building type", result["missing"])

    def test_missing_family_size_is_reported_without_guessing(self):
        result = summarize_requirements(parse_requirements("I have a 40x50 north-facing 3 BHK Ground house for my family."))
        self.assertIn("family_size", result["ambiguities"])
        self.assertNotIn("family", result["summary"])
        self.assertFalse(result["ready_for_planning"])

    def test_missing_optional_preferences_are_reported(self):
        result = summarize_requirements(parse_requirements("I have a 40x50 north-facing 3 BHK Ground house."))
        for field in ("Vastu preference", "architectural style", "climate", "parking preference"):
            self.assertIn(field, result["missing"])
        self.assertTrue(result["ready_for_planning"])

    def test_ambiguous_and_invalid_requirements_are_not_ready(self):
        ambiguous = summarize_requirements(parse_requirements("I want a big house for my family."))
        self.assertFalse(ambiguous["ready_for_planning"])
        self.assertIn("plot dimensions", ambiguous["missing"])
        self.assertIn("family_size", ambiguous["ambiguities"])

        invalid = summarize_requirements(parse_requirements("I want a 9 BHK 40x50 north-facing Ground house."))
        self.assertFalse(invalid["ready_for_planning"])
        self.assertTrue(invalid["warnings"])

    def test_clarification_questions_omit_provided_fields(self):
        questions = build_clarification_questions(parse_requirements("40x50 north-facing 3 BHK G+1 house."))
        self.assertNotIn("What are the plot dimensions?", questions)
        self.assertNotIn("How many bedrooms or what BHK do you need?", questions)
        self.assertNotIn("Which direction does the road face: North, South, East, or West?", questions)
        self.assertNotIn("How many floors or what building type do you want?", questions)
        self.assertIn("Which Vastu preference should I use: None, Basic, or Strict?", questions)

    def test_summary_does_not_invent_values(self):
        result = summarize_requirements(parse_requirements("I have a 40x50 plot."))
        self.assertEqual(result["summary"]["plot"], "40 × 50 ft")
        self.assertNotIn("bedrooms", result["summary"])
        self.assertNotIn("family", result["summary"])
        self.assertNotIn("vastu", result["summary"])


if __name__ == "__main__":
    unittest.main()
