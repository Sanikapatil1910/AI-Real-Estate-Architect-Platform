import unittest

from backend.planner.vastu_rules import evaluate_vastu, score_room_vastu
from knowledge.vastu.vastu_knowledge import (
    get_rules_for_category,
    get_rules_for_feature,
    get_rules_for_room,
    get_vastu_rules,
)


class VastuKnowledgeTests(unittest.TestCase):
    def test_dataset_loads_with_expected_rules(self):
        self.assertEqual(len(get_vastu_rules()), 257)
        self.assertEqual(len(get_rules_for_category("Vastu Matrix")), 126)

    def test_room_feature_queries(self):
        self.assertTrue(get_rules_for_room("kitchen"))
        self.assertTrue(get_rules_for_room("master_bedroom"))
        self.assertTrue(get_rules_for_feature("Main entrance"))

    def test_hard_constraints_are_distinguishable(self):
        rules = get_rules_for_category("Geometry")
        self.assertTrue(any(rule["hard_constraint_bool"] for rule in rules))
        self.assertTrue(any(not rule["hard_constraint_bool"] for rule in get_vastu_rules()))

    def test_vastu_modes(self):
        room = {
            "room_type": "kitchen",
            "x": 29,
            "y": 6,
            "width": 8,
            "length": 8,
        }
        no_vastu = score_room_vastu(room, 34, 42, "no_preference", 3, 5)
        basic = evaluate_vastu([room], 34, 42, "basic", 3, 5)
        strict = evaluate_vastu([room], 34, 42, "strict", 3, 5)
        self.assertEqual(no_vastu["status"], "ignored")
        self.assertEqual(no_vastu["score"], 100)
        self.assertEqual(basic["mode"], "basic")
        self.assertEqual(strict["mode"], "strict")
        self.assertLess(strict["overall_score"], basic["overall_score"])
        self.assertIn("rule", basic["rooms"][0])
        self.assertIn("hard_constraint_violations", strict)


if __name__ == "__main__":
    unittest.main()
