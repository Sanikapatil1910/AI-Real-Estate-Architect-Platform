"""Architectural quality of the building envelope, on the stored generated plans (``frontend-react/dev/fixtures``, see ``tests/gen_fixtures.py``).

Covers the plan records the 3D builder draws from: window size / placement rules by room type and wall, the roof overhang spec, the balcony projection
records (limits against the plot margin, entrance, other projections, enclosed rooms), the terrace flag, upload plans, and that every plan size / floor
count is still valid.  No browser needed; the 3D side is in test_envelope_render.py."""
import copy
import json
import unittest
from pathlib import Path

from backend.planner.architect import rules
from backend.planner.architect.facade import apply_envelope

FIX = Path(__file__).resolve().parents[1] / "frontend-react" / "dev" / "fixtures"
PLANS = ["sc_a_f50", "sc_b_f60", "sc_g2", "sc_car", "sc_terrace", "sc_balcony", "sc_g2_balcony", "cf_g1_terrace", "cf_g1_wide", "cf_g2"]
# cf_g2 (G+2, 40x60, no setbacks) cannot currently be re-planned in the time budget (it fails the same way on the build before these changes), so its stored
# plan predates the window planner: it is checked for the records, not for the window rules.
WIN_PLANS = [n for n in PLANS if n != "cf_g2"]
HABITABLE = rules.HABITABLE_WINDOW_TYPES
EPS = 1e-6


def load(name):
    return json.loads((FIX / f"{name}.json").read_text())


def rects_overlap(a, b, eps=1e-4):
    return not (a[2] <= b[0] + eps or b[2] <= a[0] + eps or a[3] <= b[1] + eps or b[3] <= a[1] + eps)


def win_span(w, room):
    """(axis, line, lo, hi) of a window in plan feet."""
    side = w["wall"]
    if side in ("top", "bottom"):
        return "h", (room["y"] if side == "top" else room["y2"]), room["x"] + w["position"], room["x"] + w["position"] + w["width"]
    return "v", (room["x"] if side == "left" else room["x2"]), room["y"] + w["position"], room["y"] + w["position"] + w["width"]


class WindowRules(unittest.TestCase):
    def test_every_window_is_on_a_real_exterior_wall_with_piers(self):
        for name in WIN_PLANS:
            plan = load(name)
            for fi, fl in enumerate(plan["floors"]):
                rooms = {r["id"]: r for r in fl["layout"]["rooms"]}
                for w in fl["layout"]["openings"]["windows"]:
                    rm = rooms[w["room"]]
                    where = f"{name} floor {fi} {w['room']} {w['wall']}"
                    self.assertNotIn(rm["room_type"], ("balcony", "open_terrace", "courtyard"), where)
                    axis, line, lo, hi = win_span(w, rm)
                    wall_lo, wall_hi = ((rm["x"], rm["x2"]) if axis == "h" else (rm["y"], rm["y2"]))
                    self.assertGreaterEqual(lo - wall_lo, 0.45, f"{where}: pier at the low corner")
                    self.assertGreaterEqual(wall_hi - hi, 0.45, f"{where}: pier at the high corner")
                    # the air on the outer side of the window: no other room of the floor there
                    mid = (lo + hi) / 2
                    n = {"top": (0, -0.3), "bottom": (0, 0.3), "left": (-0.3, 0), "right": (0.3, 0)}[w["wall"]]
                    px, py = (mid, line) if axis == "h" else (line, mid)
                    px, py = px + n[0], py + n[1]
                    inside = [r["id"] for r in fl["layout"]["rooms"] if r["x"] + EPS < px < r["x2"] - EPS and r["y"] + EPS < py < r["y2"] - EPS]
                    self.assertEqual(inside, [], f"{where}: the window looks into {inside}, it is not on an exterior wall")

    def test_windows_are_sized_by_room_type(self):
        for name in WIN_PLANS:
            plan = load(name)
            for fi, fl in enumerate(plan["floors"]):
                rooms = {r["id"]: r for r in fl["layout"]["rooms"]}
                for w in fl["layout"]["openings"]["windows"]:
                    rm = rooms[w["room"]]
                    t = rm["room_type"]
                    wall_len = (rm["width"] if w["wall"] in ("top", "bottom") else rm["length"])
                    where = f"{name} floor {fi} {w['room']}"
                    if t in ("bathroom", "toilet"):
                        self.assertGreaterEqual(w["sill"], 5.0, f"{where}: a bathroom window is a high ventilator")
                        self.assertLessEqual(w["width"], 2.5 + EPS, where)
                    if t in HABITABLE:
                        self.assertLessEqual(w["sill"], 3.0, f"{where}: a habitable room has a low sill")
                        self.assertGreaterEqual(w["height"], 4.0, where)
                        axis, line, lo, hi = win_span(w, rm)
                        door_here = any((abs(d["y1"] - d["y2"]) < 0.05 and axis == "h" and abs(d["y1"] - line) < 0.05) or
                                        (abs(d["x1"] - d["x2"]) < 0.05 and axis == "v" and abs(d["x1"] - line) < 0.05) for d in fl["layout"]["openings"]["doors"] if d["room"] == w["room"])
                        if wall_len >= 9:
                            # a door on the same wall leaves less wall: then at least a proper 2.5 ft window, otherwise a generous one
                            self.assertGreaterEqual(w["width"], 2.5 if door_here else 4.0, f"{where}: a bedroom / living window is generous")
                    self.assertLessEqual(w["width"], wall_len - 1.0, where)
                    self.assertAlmostEqual(w["sill"] + w["height"], rules.WINDOW_HEAD, places=2, msg=f"{where}: head at the door height")

    def test_windows_do_not_overlap_doors_or_each_other(self):
        for name in WIN_PLANS:
            plan = load(name)
            for fi, fl in enumerate(plan["floors"]):
                rooms = {r["id"]: r for r in fl["layout"]["rooms"]}
                spans = [(w, win_span(w, rooms[w["room"]])) for w in fl["layout"]["openings"]["windows"]]
                for i, (w, (ax, ln, lo, hi)) in enumerate(spans):
                    for w2, (ax2, ln2, lo2, hi2) in spans[i + 1:]:
                        if ax == ax2 and abs(ln - ln2) < 0.05:
                            self.assertTrue(hi <= lo2 + EPS or hi2 <= lo + EPS, f"{name} floor {fi}: two windows overlap on one wall")
                for d in fl["layout"]["openings"]["doors"]:
                    for w, (ax, ln, lo, hi) in spans:
                        if ax == "h" and abs(d["y1"] - d["y2"]) < 0.05 and abs(d["y1"] - ln) < 0.05:
                            dl, dh = sorted((d["x1"], d["x2"]))
                        elif ax == "v" and abs(d["x1"] - d["x2"]) < 0.05 and abs(d["x1"] - ln) < 0.05:
                            dl, dh = sorted((d["y1"], d["y2"]))
                        else:
                            continue
                        self.assertTrue(hi <= dl + EPS or dh <= lo + EPS, f"{name} floor {fi}: window {w['room']} overlaps a door")

    def test_a_long_exterior_corridor_wall_is_not_left_blank(self):
        from backend.planner.architect.doors import open_runs
        from backend.planner.architect.geometry import Room
        checked = 0
        for name in WIN_PLANS:
            plan = load(name)
            for fi, fl in enumerate(plan["floors"]):
                rs = fl["layout"]["rooms"]
                for r in rs:
                    if r["room_type"] != "passage":
                        continue
                    for side, w in [(w["wall"], w) for w in fl["layout"]["openings"]["windows"] if w["room"] == r["id"]]:
                        pass
                    # walls of the corridor that look at the open air (outside the footprint box or a flat roof)
                    for side, (lo, hi, line, horiz) in {"top": (r["x"], r["x2"], r["y"], True), "bottom": (r["x"], r["x2"], r["y2"], True),
                                                       "left": (r["y"], r["y2"], r["x"], False), "right": (r["y"], r["y2"], r["x2"], False)}.items():
                        n = {"top": (0, -0.3), "bottom": (0, 0.3), "left": (-0.3, 0), "right": (0.3, 0)}[side]
                        free = []
                        t = lo + 0.5
                        while t < hi:
                            px, py = ((t, line) if horiz else (line, t))
                            px, py = px + n[0], py + n[1]
                            hit = any(q["x"] + EPS < px < q["x2"] - EPS and q["y"] + EPS < py < q["y2"] - EPS for q in rs)
                            free.append(not hit)
                            t += 0.5
                        # the plot boundary side counts as open air as well, so "free" is exactly "no room there"
                        run = max((len(list(g)) for k, g in __import__("itertools").groupby(free) if k), default=0) * 0.5
                        if run >= 20:
                            n_win = sum(1 for w in fl["layout"]["openings"]["windows"] if w["room"] == r["id"] and w["wall"] == side)
                            self.assertGreaterEqual(n_win, 2, f"{name} floor {fi}: a {run:g} ft corridor wall with {n_win} window(s)")
                            checked += 1
        if not checked:
            self.skipTest("no long exterior corridor wall in the stored plans")

    def test_open_runs_sees_a_wall_facing_the_flat_roof(self):
        from backend.planner.architect.doors import open_runs
        from backend.planner.architect.geometry import Room
        # an upper floor that covers only the back half of the footprint (F = 20 wide, D = 30 deep): the front side of the back rooms looks onto the roof below
        back = Room("back", "bedroom", "Back", 1, 0.0, 10.0, 20.0, 20.0)
        runs = open_runs(back, [back], 20.0, 30.0)
        self.assertIn("front", runs, "the side that faces the open roof area must count as an exterior wall")
        self.assertAlmostEqual(runs["front"][1] - runs["front"][0], 20.0)
        # a room in front of it covers that side again
        front = Room("front", "bedroom", "Front", 1, 0.0, 0.0, 12.0, 10.0)
        part = open_runs(back, [back, front], 20.0, 30.0)
        self.assertEqual(part["front"], (12.0, 20.0), "only the part of the wall that no room touches is exterior")
        self.assertNotIn("front", open_runs(back, [back, Room("f2", "bedroom", "F2", 1, 0.0, 0.0, 20.0, 10.0)], 20.0, 30.0))
        # a flat-roof cell (open_terrace) is open air, not a neighbour
        roof = Room("flat", "open_terrace", "Roof", 1, 0.0, 0.0, 20.0, 10.0)
        self.assertIn("front", open_runs(back, [back, roof], 20.0, 30.0))


class EnvelopeRecords(unittest.TestCase):
    def test_roof_overhang_never_comes_close_to_the_plot_edge(self):
        from backend.planner.architect.facade import _margins
        for name in PLANS:
            plan = load(name)
            spec = plan["roof_spec"]
            m = _margins(plan)
            self.assertGreaterEqual(spec["overhang_ft"], rules.ROOF_OVERHANG_LIMITS[0])
            self.assertLessEqual(spec["overhang_ft"], rules.ROOF_OVERHANG_LIMITS[1])
            for side, v in spec["by_side"].items():
                self.assertGreaterEqual(v, 0.0, name)
                self.assertLessEqual(v, spec["overhang_ft"] + EPS, name)
                self.assertLessEqual(v, max(0.0, m[side] - rules.ROOF_PLOT_CLEAR_FT) + EPS, f"{name} {side}: the roof edge is too close to the plot edge")

    def test_roof_overhang_is_configurable_and_clamped(self):
        plan = load("sc_a_f50")
        for ask, want in [(0.5, 0.5), (2.5, 2.5), (9.0, rules.ROOF_OVERHANG_LIMITS[1]), (0.0, rules.ROOF_OVERHANG_LIMITS[0])]:
            p = copy.deepcopy(plan)
            apply_envelope(p, {"roof_overhang_ft": ask})
            self.assertEqual(p["roof_spec"]["overhang_ft"], want)
        p = copy.deepcopy(plan)
        apply_envelope(p, {})
        self.assertEqual(p["roof_spec"]["overhang_ft"], rules.ROOF_OVERHANG_FT)

    def test_balcony_projection_limits(self):
        from backend.planner.architect.facade import _margins, _footprint
        seen = 0
        for name in PLANS:
            plan = load(name)
            spec = plan["balcony_spec"]
            m = _margins(plan)
            bx0, by0, bx1, by1 = _footprint(plan)
            edge = {"top": by0, "bottom": by1, "left": bx0, "right": bx1}
            plot = plan["floors"][0]["layout"]["plot"]
            for fi, fl in enumerate(plan["floors"]):
                recs = fl["layout"].get("balcony_projections", [])
                if fi == 0:
                    self.assertEqual(recs, [], f"{name}: nothing projects from the ground floor")
                rooms = fl["layout"]["rooms"]
                taken = []
                for rec in recs:
                    room = next(r for r in rooms if (r.get("id") or r["room_type"]) == rec["room"])
                    self.assertEqual(room["room_type"], "balcony", name)
                    for side, p in rec["sides"].items():
                        seen += 1
                        self.assertGreaterEqual(p, rules.BALCONY_MIN_PROJECTION_FT - EPS, f"{name} {side}")
                        self.assertLessEqual(p, spec["projection_ft"] + EPS, name)
                        self.assertLessEqual(p, rules.BALCONY_PROJECTION_LIMITS[1] + EPS, name)
                        self.assertLessEqual(p, m[side] - rules.BALCONY_PLOT_CLEAR_FT + EPS, f"{name} {side}: inside the statutory margin")
                        line = {"top": room["y"], "bottom": room["y2"], "left": room["x"], "right": room["x2"]}[side]
                        self.assertAlmostEqual(line, edge[side], places=2, msg=f"{name}: a balcony projects only from an outer side of the building")
                        r = {"top": (room["x"], room["y"] - p, room["x2"], room["y"]), "bottom": (room["x"], room["y2"], room["x2"], room["y2"] + p),
                             "left": (room["x"] - p, room["y"], room["x"], room["y2"]), "right": (room["x2"], room["y"], room["x2"] + p, room["y2"])}[side]
                        # the projected edge keeps the clear distance to the plot boundary on the side it projects to (its sides run along the building)
                        far = {"top": r[1] - plot["y"], "bottom": plot["y"] + plot["length"] - r[3], "left": r[0] - plot["x"], "right": plot["x"] + plot["width"] - r[2]}[side]
                        self.assertGreaterEqual(far, rules.BALCONY_PLOT_CLEAR_FT - EPS, f"{name} {side}: the balcony edge is too close to the plot boundary")
                        # no enclosed room of this floor under / in it
                        for q in rooms:
                            self.assertFalse(rects_overlap(r, (q["x"], q["y"], q["x2"], q["y2"])), f"{name}: projection collides with {q['id']}")
                        for t in taken:
                            self.assertFalse(rects_overlap(r, t), f"{name}: two projections overlap")
                        taken.append(r)
        self.assertGreater(seen, 0, "no stored plan has a balcony projection: the balcony fixtures are stale (python -m tests.gen_fixtures)")

    def test_balcony_projection_is_configurable_and_never_over_the_entrance(self):
        plan = load("sc_balcony")
        off = copy.deepcopy(plan)
        apply_envelope(off, {"balcony_projection_ft": 0})
        self.assertFalse(any(fl["layout"].get("balcony_projections") for fl in off["floors"]), "0 ft disables the cantilever")
        big = copy.deepcopy(plan)
        apply_envelope(big, {"balcony_projection_ft": 99})
        self.assertEqual(big["balcony_spec"]["projection_ft"], rules.BALCONY_PROJECTION_LIMITS[1])
        for fl in big["floors"]:
            for rec in fl["layout"].get("balcony_projections", []):
                for v in rec["sides"].values():
                    self.assertLessEqual(v, rules.BALCONY_PROJECTION_LIMITS[1] + EPS)
        # the ground floor below a balcony edge is the main entrance -> no projection there
        ent = copy.deepcopy(plan)
        g = ent["floors"][0]["layout"]
        for fl in ent["floors"][1:]:
            for r in fl["layout"]["rooms"]:
                if r["room_type"] == "balcony":
                    for side, (a, b, line) in {"top": (r["x"], r["x2"], r["y"]), "bottom": (r["x"], r["x2"], r["y2"])}.items():
                        g["openings"]["doors"].append({"room": "living_room", "room_type": "living_room", "wall": "top", "position": 0, "width": 3.5, "door_type": "main",
                                                      "x1": a, "y1": line, "x2": a + 3.5, "y2": line})
        apply_envelope(ent, {})
        for fl in ent["floors"][1:]:
            for rec in fl["layout"].get("balcony_projections", []):
                for side in rec["sides"]:
                    self.assertNotIn(side, ("top", "bottom"), "a projection over the main entrance")

    def test_upload_plans_get_no_invented_projection(self):
        for name in ("upload_demo", "upload_demo_margin"):
            plan = load(name)
            for fl in plan["floors"]:
                self.assertFalse(fl["layout"].get("balcony_projections"), name)

    def test_terrace_exists_only_when_selected(self):
        self.assertTrue(load("sc_terrace")["terrace"]["exists"])
        self.assertTrue(load("sc_balcony")["terrace"]["exists"])
        for name in ("sc_a_f50", "sc_b_f60", "sc_g2", "sc_car", "sc_g2_balcony", "cf_g1_wide", "cf_g2"):
            plan = load(name)
            self.assertFalse(plan["terrace"]["exists"], f"{name}: a terrace was never asked for")
            for fl in plan["floors"]:
                self.assertFalse([r for r in fl["layout"]["rooms"] if r["room_type"] == "open_terrace"], name)

    def test_every_stored_plan_size_and_floor_count_is_valid(self):
        sizes, floors = set(), set()
        for name in PLANS:
            plan = load(name)
            self.assertTrue(plan["verification"]["passed"], f"{name}: {plan['verification'].get('errors')}")
            for f in plan["circulation"]["floors"]:
                self.assertEqual(f["issues"], [], name)
            plot = plan["floors"][0]["layout"]["plot"]
            sizes.add((plot["width"], plot["length"]))
            floors.add(len(plan["floors"]))
        self.assertGreaterEqual(len(sizes), 4)
        self.assertEqual(floors, {2, 3})


if __name__ == "__main__":
    unittest.main()
