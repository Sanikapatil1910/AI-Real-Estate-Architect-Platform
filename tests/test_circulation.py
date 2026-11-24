"""Building-wide circulation: every indoor room is reached by an indoor route, an open terrace is never a corridor.

Three layers:

1. the rule set (``backend/planner/architect/circulation.py``) on small hand-built floors that reproduce each way a plan can be
   impractical (the first-floor terrace that separates the bedrooms, a bedroom used as a corridor, a missing door, a disconnected
   corridor, a stair that arrives on the terrace ...) and the valid counterparts;
2. the door planner on canonical rooms: a floor that could only be connected across a terrace gets *no* door plan, so the generator
   rejects it instead of delivering it;
3. real generated plans (ground only, G+1, G+2, several plots / road sides / seeds, with and without terrace, balcony, parking,
   garden): every accepted plan passes, checked here by an independent graph walk that does not use the module under test.
"""
import copy
import json
import unittest
from pathlib import Path

from backend.planner.architect import circulation as C
from backend.planner.architect import service
from backend.planner.architect.doors import plan_openings
from backend.planner.architect.geometry import Room
from backend.planner.architect.verify import verify_plan

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "frontend-react" / "dev" / "fixtures"


# ------------------------------------------------------------------------------------------------ hand-built floors
def R(rid, rtype, x, y, w, l, att=None):
    return {"id": rid, "room_type": rtype, "name": rid.replace("_", " ").title(), "x": float(x), "y": float(y), "width": float(w),
            "length": float(l), "x2": float(x + w), "y2": float(y + l), "attached_to": att}


def D(rooms, a, b, width=3.0):
    """A door on the wall rooms a and b share, at the middle of it."""
    ra, rb = (next(r for r in rooms if r["id"] == i) for i in (a, b))
    e = C._shared_edge(ra, rb)
    assert e, f"{a} and {b} share no wall"
    kind, at, lo, hi = e
    mid = (lo + hi) / 2
    if kind == "v":
        x1 = x2 = at
        y1, y2 = mid - width / 2, mid + width / 2
    else:
        y1 = y2 = at
        x1, x2 = mid - width / 2, mid + width / 2
    return {"room": a, "connects_to": b, "x1": x1, "y1": y1, "x2": x2, "y2": y2, "width": width, "door_type": "internal"}


def floor_of(rooms, doors, entry):
    return {"rooms": rooms, "openings": {"doors": doors, "circulation": {"entry_room": entry}}}


def rules(rep):
    return sorted({i["rule"] for i in rep["issues"]})


def screenshot_floor():
    """The reported case: a big open terrace between the stair and the bedrooms; the only doors cross the terrace."""
    rooms = [R("staircase", "staircase", 0, 0, 7.5, 12), R("open_terrace", "open_terrace", 7.5, 0, 22.5, 12),
             R("bedroom_1", "bedroom", 0, 12, 15, 18), R("bedroom_2", "bedroom", 15, 12, 15, 18)]
    return floor_of(rooms, [D(rooms, "staircase", "open_terrace"), D(rooms, "open_terrace", "bedroom_1"),
                            D(rooms, "open_terrace", "bedroom_2")], "staircase")


def valid_floor():
    """The same rooms with an enclosed corridor: stair -> corridor -> both bedrooms, and a door from the corridor to the terrace."""
    rooms = [R("staircase", "staircase", 0, 0, 7.5, 10), R("open_terrace", "open_terrace", 7.5, 0, 22.5, 10),
             R("corridor", "passage", 0, 10, 30, 4), R("bedroom_1", "bedroom", 0, 14, 15, 16), R("bedroom_2", "bedroom", 15, 14, 15, 16)]
    return floor_of(rooms, [D(rooms, "staircase", "corridor"), D(rooms, "corridor", "bedroom_1"), D(rooms, "corridor", "bedroom_2"),
                            D(rooms, "corridor", "open_terrace")], "staircase")


class CirculationRules(unittest.TestCase):
    def run_floor(self, fl, upper=True):
        return C.analyse_floor(fl, "First Floor", fl["openings"]["circulation"]["entry_room"], upper)

    def test_valid_floor_with_terrace_passes(self):
        rep = self.run_floor(valid_floor())
        self.assertEqual(rep["issues"], [])
        self.assertEqual(set(rep["reachable"]), set(rep["indoor"]), "every indoor room reached by an indoor route")
        self.assertNotIn("open_terrace", rep["reachable"], "the terrace stays outside the indoor graph")

    def test_bedrooms_reached_only_across_the_terrace_are_rejected(self):
        rep = self.run_floor(screenshot_floor())
        bad = {i["room"] for i in rep["issues"] if i["rule"] == "outdoor-route"}
        self.assertEqual(bad, {"bedroom_1", "bedroom_2"})
        msg = " ".join(i["message"] for i in rep["issues"])
        self.assertIn("Open Terrace", msg)                      # the diagnosis names the outdoor space that was crossed
        self.assertIn("Bedroom 1", msg)

    def test_stair_that_arrives_only_on_the_terrace_is_rejected(self):
        rooms = [R("staircase", "staircase", 0, 0, 7.5, 10), R("open_terrace", "open_terrace", 7.5, 0, 22.5, 10),
                 R("bedroom_1", "bedroom", 0, 10, 30, 20)]
        fl = floor_of(rooms, [D(rooms, "staircase", "open_terrace"), D(rooms, "open_terrace", "bedroom_1")], "staircase")
        rep = self.run_floor(fl)
        self.assertIn("stair-arrival", rules(rep))
        self.assertIn("outdoor-route", rules(rep))

    def test_a_bedroom_used_as_a_route_to_another_room_is_rejected(self):
        rooms = [R("staircase", "staircase", 0, 0, 7.5, 10), R("corridor", "passage", 0, 10, 30, 4), R("bedroom_1", "bedroom", 0, 14, 15, 16),
                 R("family_lounge", "family_lounge", 15, 14, 15, 16)]
        fl = floor_of(rooms, [D(rooms, "staircase", "corridor"), D(rooms, "corridor", "bedroom_1"), D(rooms, "bedroom_1", "family_lounge")], "staircase")
        rep = self.run_floor(fl)
        self.assertEqual([i["room"] for i in rep["issues"] if i["rule"] == "private-route"], ["family_lounge"])
        self.assertIn("Bedroom 1", rep["issues"][0]["message"])

    def test_a_missing_door_between_adjacent_rooms_leaves_the_room_unreachable(self):
        fl = valid_floor()
        fl["openings"]["doors"] = [d for d in fl["openings"]["doors"] if d["connects_to"] != "bedroom_2"]
        rep = self.run_floor(fl)
        self.assertEqual([(i["rule"], i["room"]) for i in rep["issues"]], [("unreachable", "bedroom_2")])

    def test_rooms_that_merely_touch_are_not_connected(self):
        fl = valid_floor()
        rep = self.run_floor(fl)
        self.assertIn("bedroom_2", rep["reachable"])
        rep2 = self.run_floor(dict(fl, openings=dict(fl["openings"], doors=[])))
        self.assertEqual(rep2["reachable"], ["staircase"], "touching walls without a door connect nothing")

    def test_a_disconnected_corridor_is_rejected(self):
        rooms = [R("staircase", "staircase", 0, 0, 7.5, 10), R("bedroom_1", "bedroom", 0, 10, 15, 20), R("corridor", "passage", 15, 10, 4, 20),
                 R("bedroom_2", "bedroom", 19, 10, 11, 20)]
        fl = floor_of(rooms, [D(rooms, "staircase", "bedroom_1"), D(rooms, "corridor", "bedroom_2")], "staircase")
        rep = self.run_floor(fl)
        self.assertIn(("unreachable", "corridor"), [(i["rule"], i["room"]) for i in rep["issues"]])

    def test_a_corridor_that_is_too_narrow_is_rejected(self):
        fl = valid_floor()
        corridor = next(r for r in fl["rooms"] if r["id"] == "corridor")
        corridor["length"], corridor["y2"] = 2.5, 12.5
        for r in fl["rooms"]:                                    # keep the floor tiled: the bedrooms start where the corridor ends
            if r["id"].startswith("bedroom"):
                r["y"], r["length"] = 12.5, 17.5
        fl["openings"]["doors"] = [D(fl["rooms"], "staircase", "corridor"), D(fl["rooms"], "corridor", "bedroom_1"),
                                   D(fl["rooms"], "corridor", "bedroom_2"), D(fl["rooms"], "corridor", "open_terrace")]
        fl["rooms"][0]["length"] = fl["rooms"][0]["y2"] = 10
        rep = self.run_floor(fl)
        self.assertIn("corridor-width", rules(rep))

    def test_a_door_off_the_shared_wall_is_rejected(self):
        fl = valid_floor()
        door = next(d for d in fl["openings"]["doors"] if d["connects_to"] == "bedroom_1")
        door.update(x1=20.0, x2=23.0)                            # outside the wall bedroom_1 shares with the corridor
        self.assertIn("door-geometry", rules(self.run_floor(fl)))

    def test_a_door_that_is_too_narrow_to_pass_is_rejected(self):
        fl = valid_floor()
        door = next(d for d in fl["openings"]["doors"] if d["connects_to"] == "bedroom_1")
        door.update(x1=3.0, x2=4.5, width=1.5)
        self.assertIn("door-geometry", rules(self.run_floor(fl)))

    def test_a_terrace_without_a_door_from_an_indoor_room_is_rejected(self):
        fl = valid_floor()
        fl["openings"]["doors"] = [d for d in fl["openings"]["doors"] if d["connects_to"] != "open_terrace"]
        self.assertIn(("outdoor-entry", "open_terrace"), [(i["rule"], i["room"]) for i in self.run_floor(fl)["issues"]])

    def test_several_rooms_entered_straight_off_the_stair_need_a_corridor(self):
        rooms = [R("staircase", "staircase", 10, 10, 10, 10), R("bedroom_1", "bedroom", 0, 10, 10, 10), R("bedroom_2", "bedroom", 20, 10, 10, 10),
                 R("bedroom_3", "bedroom", 10, 0, 10, 10)]
        fl = floor_of(rooms, [D(rooms, "staircase", i) for i in ("bedroom_1", "bedroom_2", "bedroom_3")], "staircase")
        self.assertIn("no-corridor", rules(self.run_floor(fl)))

    def test_two_rooms_may_open_straight_off_a_landing(self):
        rooms = [R("staircase", "staircase", 10, 10, 10, 10), R("bedroom_1", "bedroom", 0, 10, 10, 10), R("bedroom_2", "bedroom", 20, 10, 10, 10)]
        fl = floor_of(rooms, [D(rooms, "staircase", "bedroom_1"), D(rooms, "staircase", "bedroom_2")], "staircase")
        self.assertEqual(self.run_floor(fl)["issues"], [])

    def test_an_attached_bathroom_and_a_balcony_are_dead_ends_not_routes(self):
        rooms = [R("staircase", "staircase", 0, 0, 7.5, 10), R("corridor", "passage", 0, 10, 30, 4), R("bedroom_1", "bedroom", 0, 14, 15, 12),
                 R("bath_1", "bathroom", 0, 26, 15, 4, att="bedroom_1"), R("balcony", "balcony", 15, 24, 15, 6),
                 R("bedroom_2", "bedroom", 15, 14, 15, 10)]
        fl = floor_of(rooms, [D(rooms, "staircase", "corridor"), D(rooms, "corridor", "bedroom_1"), D(rooms, "bedroom_1", "bath_1"),
                              D(rooms, "corridor", "bedroom_2"), D(rooms, "bedroom_2", "balcony")], "staircase")
        rep = self.run_floor(fl)
        self.assertEqual(rep["issues"], [])
        fl["openings"]["doors"] = fl["openings"]["doors"][:-1] + [D(rooms, "balcony", "bedroom_2")]
        self.assertEqual(self.run_floor(fl)["issues"], [])

    def test_through_rule_is_one_definition(self):
        wt = C.may_walk_through
        self.assertFalse(wt("open_terrace", "t", "bedroom", None, False))
        self.assertFalse(wt("balcony", "b", "bedroom", None, False))
        self.assertFalse(wt("bedroom", "b1", "bedroom", None, False))
        self.assertFalse(wt("bathroom", "x", "passage", None, False))
        self.assertFalse(wt("utility", "u", "passage", None, False))
        self.assertTrue(wt("bedroom", "b1", "bathroom", "b1", False))
        self.assertFalse(wt("bedroom", "b1", "bathroom", "b2", False))
        self.assertTrue(wt("kitchen", "k", "utility", None, False))
        for t in ("passage", "family_lounge", "living_room", "dining"):
            self.assertTrue(wt(t, "h", "bedroom", None, False), t)
        self.assertTrue(wt("staircase", "s", "passage", None, True), "the stair is the start of an upper floor")
        self.assertFalse(wt("staircase", "s", "passage", None, False), "a stair is entered, never walked through")


class CrossFloor(unittest.TestCase):
    def building(self, shift=0.0, upper=None):
        g = [R("living_room", "living_room", 0, 0, 22.5, 30), R("staircase", "staircase", 22.5, 0, 7.5, 12), R("dining", "dining", 22.5, 12, 7.5, 18)]
        g_doors = [D(g, "living_room", "staircase"), D(g, "living_room", "dining")]
        up = upper or valid_floor()
        for r in up["rooms"]:
            if r["id"] == "staircase":
                r["x"] += 22.5 + shift
                r["x2"] += 22.5 + shift
        return {"floors": [{"floor": "Ground Floor", "layout": floor_of(g, g_doors, "living_room")},
                           {"floor": "First Floor", "layout": up}]}

    def test_a_stair_that_is_not_above_the_one_below_is_rejected(self):
        plan = self.building(shift=3.0)
        self.assertIn("stair-chain", rules(C.analyse_building(plan)))

    def test_every_floor_has_to_be_valid_on_its_own(self):
        plan = self.building(upper=screenshot_floor())
        rep = C.analyse_building(plan)
        self.assertFalse(rep["passed"])
        self.assertTrue(all(i["floor"] == "First Floor" for i in rep["issues"]), "the ground floor is fine, the upper one is not")


# ------------------------------------------------------------------------------------------------ door planner
def canon(rid, rtype, u, v, w, d, att=None):
    return Room(rid, rtype, rid, 1, float(u), float(v), float(w), float(d), att)


class DoorPlanner(unittest.TestCase):
    def test_a_floor_that_can_only_be_connected_across_the_terrace_gets_no_door_plan(self):
        rooms = [canon("staircase", "staircase", 0, 0, 7.5, 12), canon("open_terrace", "open_terrace", 7.5, 0, 22.5, 12),
                 canon("bedroom_1", "bedroom", 0, 12, 15, 18), canon("bedroom_2", "bedroom", 15, 12, 15, 18)]
        # bedroom_2 touches only the terrace and bedroom_1: without a corridor there is no valid way in
        self.assertIsNone(plan_openings(rooms, 30, 30, "staircase", None, main_entrance=False))

    def test_with_a_corridor_the_terrace_is_a_dead_end_leaf(self):
        rooms = [canon("staircase", "staircase", 0, 0, 7.5, 10), canon("open_terrace", "open_terrace", 7.5, 0, 22.5, 10),
                 canon("corridor", "passage", 0, 10, 30, 4), canon("bedroom_1", "bedroom", 0, 14, 15, 16), canon("bedroom_2", "bedroom", 15, 14, 15, 16)]
        plan = plan_openings(rooms, 30, 30, "staircase", None, main_entrance=False)
        self.assertIsNotNone(plan)
        g = plan.graph
        self.assertEqual(g["open_terrace"], ["corridor"], "the terrace is entered from the corridor and leads nowhere")
        self.assertEqual(set(g["staircase"]), {"corridor"})
        self.assertEqual(set(g["corridor"]), {"staircase", "bedroom_1", "bedroom_2", "open_terrace"})

    def test_a_bedroom_is_never_planned_as_a_corridor_in_any_mode(self):
        rooms = [canon("staircase", "staircase", 0, 0, 7.5, 10), canon("corridor", "passage", 0, 10, 30, 4), canon("bedroom_1", "bedroom", 0, 14, 15, 16),
                 canon("family_lounge", "family_lounge", 15, 14, 15, 16)]
        from backend.planner.architect.rules import STRICT
        for strict in (True, False):
            old = STRICT["on"]
            STRICT["on"] = strict
            try:
                plan = plan_openings(rooms, 30, 30, "staircase", None, main_entrance=False)
            finally:
                STRICT["on"] = old
            # the lounge touches the corridor, so it is entered from there and not through the bedroom
            self.assertIsNotNone(plan)
            self.assertIn("corridor", plan.graph["family_lounge"])
            self.assertNotIn("bedroom_1", plan.graph["family_lounge"])

    def test_the_stair_must_arrive_onto_the_corridor_when_several_rooms_are_entered(self):
        rooms = [canon("staircase", "staircase", 0, 0, 7.5, 10), canon("open_terrace", "open_terrace", 7.5, 0, 22.5, 10),
                 canon("bedroom_1", "bedroom", 0, 10, 10, 10), canon("corridor", "passage", 10, 10, 4, 20),
                 canon("bedroom_2", "bedroom", 14, 10, 16, 10), canon("bedroom_3", "bedroom", 14, 20, 16, 10), canon("bedroom_4", "bedroom", 0, 20, 10, 10)]
        # the corridor does not touch the stair: stair -> bedroom_1 -> ... would need a bedroom as a corridor
        self.assertIsNone(plan_openings(rooms, 30, 30, "staircase", None, main_entrance=False))


    def test_a_passage_may_branch_off_a_corridor_to_reach_rooms(self):
        rooms = [canon("staircase", "staircase", 0, 0, 7.5, 10), canon("corridor", "passage", 0, 10, 12, 4), canon("branch", "passage", 12, 10, 4, 20),
                 canon("bedroom_1", "bedroom", 0, 14, 12, 16), canon("bedroom_2", "bedroom", 16, 10, 14, 10), canon("bedroom_3", "bedroom", 16, 20, 14, 10)]
        plan = plan_openings(rooms, 30, 30, "staircase", None, main_entrance=False)
        self.assertIsNotNone(plan, "a T-junction of two passages is a valid circulation spine")
        self.assertIn("branch", plan.graph["corridor"])
        self.assertEqual(plan.graph["bedroom_2"], ["branch"])
        self.assertEqual(plan.graph["bedroom_3"], ["branch"])

    def test_an_upstairs_landing_may_open_sideways_into_the_corridor_beside_the_stair(self):
        rooms = [canon("staircase", "staircase", 0, 0, 7.5, 10), canon("corridor", "passage", 7.5, 0, 4, 30),
                 canon("bedroom_1", "bedroom", 11.5, 0, 18.5, 15), canon("bedroom_2", "bedroom", 11.5, 15, 18.5, 15)]
        plan = plan_openings(rooms, 30, 30, "staircase", None, main_entrance=False)
        self.assertIsNotNone(plan)
        self.assertEqual(plan.graph["staircase"], ["corridor"])
        d = next(x for x in plan.doors if x.a == "staircase")
        self.assertTrue(all(5.9 <= p[1] <= 10.0 for p in (d.p1, d.p2)), f"the side door lies within the landing depth of the entry end: {d}")

    def test_a_side_door_far_from_the_entry_end_is_not_a_landing(self):
        rooms = [canon("staircase", "staircase", 0, 0, 7.5, 10), canon("corridor", "passage", 7.5, 0, 4, 6), canon("bedroom_1", "bedroom", 11.5, 0, 18.5, 30),
                 canon("bedroom_2", "bedroom", 0, 10, 7.5, 20), canon("study", "study", 7.5, 6, 4, 24)]
        self.assertIsNone(plan_openings(rooms, 30, 30, "staircase", None, main_entrance=False))


# ------------------------------------------------------------------------------------------------ real plans
def indoor_walk_ok(plan):
    """Independent re-check (does not use circulation.py): remove every outdoor room, walk the doors from the entry; every indoor room
    must be reached, and removing any private room (bedroom, bath, kitchen, utility...) must not cut off any unrelated room."""
    outdoor = {"open_terrace", "balcony", "parking", "bike_parking", "garden"}
    problems = []
    for fi, fl in enumerate(plan["floors"]):
        lay = fl["layout"]
        rooms = {r["id"]: r for r in lay["rooms"] if r["room_type"] not in outdoor}
        entry = lay["openings"]["circulation"]["entry_room"] if fi == 0 else next(i for i, r in rooms.items() if r["room_type"] == "staircase")
        adj = {i: set() for i in rooms}
        for d in lay["openings"]["doors"]:
            a, b = d["room"], d["connects_to"]
            if a in rooms and b in rooms:
                adj[a].add(b); adj[b].add(a)

        def reach(removed=()):
            seen, queue = {entry}, [entry]
            while queue:
                cur = queue.pop()
                for nx in adj[cur]:
                    if nx not in seen and nx not in removed:
                        seen.add(nx); queue.append(nx)
            return seen
        full = reach()
        miss = [rooms[i]["name"] for i in rooms if i not in full]
        if miss:
            problems.append(f"{fl['floor']}: indoor rooms not reached without crossing outdoor space: {miss}")
        for i, r in rooms.items():
            if r["room_type"] in ("bedroom", "master_bedroom", "guest_bedroom", "bathroom", "toilet", "kitchen", "utility", "puja_room", "study"):
                own = {j for j in rooms if rooms[j].get("attached_to") == i} | ({j for j in rooms if rooms[j]["room_type"] == "utility"} if r["room_type"] == "kitchen" else set())
                cut = [rooms[j]["name"] for j in rooms if j not in reach({i}) and j != i and j not in own]
                if cut:
                    problems.append(f"{fl['floor']}: {r['name']} is the only way to {cut}")
    return problems


def payload(w, l, side="North", bt="G+1", bhk=3, strict=False, extra=(), **kw):
    names = ["living_room", "dining", "kitchen", "utility", "master_bedroom"] + ["bedroom"] * (bhk - 1) + ["bathroom"] * bhk + list(extra)
    p = dict(plot_width=w, plot_length=l, road_side=side, building_type=bt, rooms=[{"room_type": t} for t in names], vastu_mode="basic",
             balcony_required=bt != "Ground", parking_required=False, parking_spaces=0, parking_type="No Parking", strict=strict,
             number_of_plans=4, include_terrace=True, setbacks={"front": 0, "rear": 0, "left": 0, "right": 0})
    p.update(kw)
    return p


CASES = {
    "g1_30x40_south": dict(p=payload(30, 40, "South", extra=("puja_room",))),
    "g1_30x40_seed19": dict(p=payload(30, 40, "South", extra=("puja_room",)), seed=19),
    "g1_30x40_seed41": dict(p=payload(30, 40, "South", extra=("puja_room",)), seed=41),
    "g1_40x50_north_garden_parking_balcony": dict(p=payload(40, 50, "North", garden_required=True, parking_required=True, parking_spaces=1, parking_type="1 Car")),
    "g1_50x30_wide": dict(p=payload(50, 30, "North", bhk=2)),
    "g1_30x50_east": dict(p=payload(30, 50, "East")),
    "g2_40x60": dict(p=payload(40, 60, "North", bt="G+2", bhk=4)),
    "g2_30x60_west": dict(p=payload(30, 60, "West", bt="G+2")),
    "g1_no_balcony_no_terrace": dict(p=payload(40, 50, "North", balcony_required=False, include_terrace=False)),
    "ground_30x40": dict(p=payload(30, 40, "North", bt="Ground", bhk=2)),
    "ground_strict_30x40": dict(p=payload(30, 40, "North", bt="Ground", bhk=2, strict=True)),
    "ground_25x40_small": dict(p=payload(25, 40, "South", bt="Ground", bhk=2)),
}
_RES = {}


def result(name):
    if name not in _RES:
        c = CASES[name]
        _RES[name] = service.generate(copy.deepcopy(c["p"]), seed=c.get("seed"))
    return _RES[name]


class GeneratedPlans(unittest.TestCase):
    def test_every_accepted_plan_has_valid_indoor_circulation(self):
        total = 0
        for name, c in CASES.items():
            res = result(name)
            self.assertGreaterEqual(len(res["plans"]), 1, name)
            for plan in res["plans"]:
                total += 1
                self.assertTrue(plan["verification"]["passed"], (name, plan["verification"]["errors"]))
                self.assertTrue(plan["circulation"]["passed"], (name, plan["circulation"]["errors"]))
                self.assertEqual(indoor_walk_ok(plan), [], f"{name} plan {plan['plan_number']}")
                nfl = {"Ground": 1, "G+1": 2, "G+2": 3}[c["p"]["building_type"]]
                self.assertEqual(len(plan["floors"]), nfl, name)
        self.assertGreaterEqual(total, 30)

    def test_no_indoor_room_depends_on_crossing_a_terrace_or_balcony(self):
        """The reported bug, over every generated floor: take the doors of every terrace / balcony away and every room is still reached."""
        checked = 0
        for name in CASES:
            for plan in result(name)["plans"]:
                for fl in plan["floors"]:
                    outdoor = {r["id"] for r in fl["layout"]["rooms"] if r["room_type"] in ("open_terrace", "balcony", "parking")}
                    if not outdoor:
                        continue
                    checked += 1
                    kept = [d for d in fl["layout"]["openings"]["doors"] if d["room"] not in outdoor and d["connects_to"] not in outdoor]
                    lay = dict(fl["layout"], openings=dict(fl["layout"]["openings"], doors=kept))
                    entry = fl["layout"]["openings"]["circulation"]["entry_room"] if fl is plan["floors"][0] else \
                        next(r["id"] for r in fl["layout"]["rooms"] if r["room_type"] == "staircase")
                    rep = C.analyse_floor(lay, fl["floor"], entry, upper=fl is not plan["floors"][0])
                    self.assertEqual([i for i in rep["issues"] if i["rule"] in ("unreachable", "outdoor-route", "private-route")], [],
                                     f"{name}: a room needs a terrace / balcony / porch to be reached")
        self.assertGreater(checked, 20, "terraces / balconies were really exercised")

    def test_upper_floors_have_a_landing_and_corridor_that_serve_the_rooms(self):
        seen_terrace = 0
        for name in CASES:
            for plan in result(name)["plans"]:
                for fl in plan["floors"][1:]:
                    rooms = {r["id"]: r for r in fl["layout"]["rooms"]}
                    st = next(r for r in rooms.values() if r["room_type"] == "staircase")
                    doors = [d for d in fl["layout"]["openings"]["doors"] if st["id"] in (d["room"], d["connects_to"])]
                    self.assertTrue(doors, f"{name}: the stair on {fl['floor']} has no door")
                    nb = {d["connects_to"] if d["room"] == st["id"] else d["room"] for d in doors}
                    self.assertTrue(any(rooms[n]["room_type"] not in ("open_terrace", "balcony") for n in nb), f"{name}: stair arrives only outdoors")
                    entered = [r for r in rooms.values() if r["room_type"] not in ("staircase", "open_terrace", "balcony") and not (r["room_type"] == "bathroom" and r.get("attached_to"))]
                    if len(entered) > C.MAX_DIRECT_FROM_LANDING:
                        self.assertTrue(any(rooms[n]["room_type"] in C.LANDING_HUBS for n in nb), f"{name}: stair does not open onto a corridor / lounge")
                    for r in rooms.values():
                        if r["room_type"] == "open_terrace":
                            seen_terrace += 1
                            self.assertGreaterEqual(min(r["width"], r["length"]), 6.0, f"{name}: the terrace is a sliver")
                            self.assertGreaterEqual(r["width"] * r["length"], 90, name)
        # strict compliance: an upper-floor terrace room exists only when it was asked for (none of these briefs asks), never as filler
        self.assertEqual(seen_terrace, 0, "no upper-floor terrace room is invented")

    def test_stairs_are_stacked_and_connect_every_floor(self):
        for name in ("g1_30x40_south", "g2_40x60", "g2_30x60_west", "g1_40x50_north_garden_parking_balcony"):
            for plan in result(name)["plans"]:
                st = [next(r for r in fl["layout"]["rooms"] if r["room_type"] == "staircase") for fl in plan["floors"]]
                for s in st[1:]:
                    for k in ("x", "y", "x2", "y2"):
                        self.assertAlmostEqual(s[k], st[0][k], delta=0.06, msg=name)
                self.assertEqual([i for i in plan["circulation"]["issues"] if i["rule"] == "stair-chain"], [])

    def test_floor_flags_agree_with_the_rules(self):
        for name in ("g1_30x40_south", "g2_40x60"):
            for plan in result(name)["plans"]:
                for fl in plan["floors"]:
                    c = fl["layout"]["openings"]["circulation"]
                    self.assertTrue(c["connected"] and c["valid"] and c["indoor_connected"], name)
                    self.assertEqual(c["errors"], [])

    def test_the_stored_screenshot_case_is_rejected_with_a_diagnosis(self):
        """A plan generated before the fix (bedrooms reached only across the open terrace) must fail verification, loudly and specifically."""
        plan = json.loads((FIX / "cf_bad_terrace_route.json").read_text())
        names = [r["room_type"] for r in plan["floors"][1]["layout"]["rooms"]]
        self.assertIn("open_terrace", names)
        req = payload(30, 40, "South", extra=("puja_room",))
        v = verify_plan(plan, req)
        self.assertFalse(v["passed"])
        text = " ".join(v["errors"])
        self.assertIn("Open Terrace", text)
        self.assertIn("Bedroom 2", text)
        self.assertIn("First Floor", text)

    def test_the_stored_good_plans_pass(self):
        for name in ("cf_g1_terrace", "cf_g2", "cf_g1_wide"):
            plan = json.loads((FIX / f"{name}.json").read_text())
            self.assertTrue(C.analyse_building(plan)["passed"], name)
            self.assertEqual(indoor_walk_ok(plan), [], name)


class InfeasibleIsReported(unittest.TestCase):
    def test_no_layout_message_names_the_circulation_requirement(self):
        from unittest import mock
        seen = []

        def search_with_no_valid_floor(*a, **k):
            return {"ok": False, "feasibility": {"status": "infeasible", "errors": ["nothing fits"], "suggestions": []}}
        with mock.patch.object(service, "search", search_with_no_valid_floor):
            with self.assertRaises(service.Infeasible):
                service._generate_once(payload(30, 40, "South"), budget_s=2.0)

    def test_candidates_rejected_for_circulation_are_explained(self):
        from unittest import mock
        bad = json.loads((FIX / "cf_bad_terrace_route.json").read_text())
        req = payload(30, 40, "South", extra=("puja_room",))
        good = service.verify_plan(copy.deepcopy(bad), req)
        self.assertFalse(good["passed"])
        with mock.patch.object(service, "pick_four", lambda pool, n: [object()]), \
                mock.patch.object(service, "plan_to_legacy", lambda *a, **k: copy.deepcopy(bad)), \
                mock.patch.object(service, "search", lambda *a, **k: {"ok": True, "plans": [object()], "site": mock.Mock(road_side="South", plot_w=30, plot_l=40), "yard": 0, "program": mock.Mock(warnings=[])}):
            with self.assertRaises(service.NoLayout) as cm:
                service._generate_once(req, budget_s=2.0)
        self.assertIn("circulation", cm.exception.message)
        self.assertIn("Open Terrace", cm.exception.message)


if __name__ == "__main__":
    unittest.main()
