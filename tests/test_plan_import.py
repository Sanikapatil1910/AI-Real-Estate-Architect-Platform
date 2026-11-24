"""Plan-image upload workflow: validation, Gemini client (mocked: no network, no key), reading clean-up, scale, draft, plan, API.

Gemini itself is never called here.  The mocked answers mimic its structured output; what is tested is everything around it."""
import json
import os
import unittest
from io import BytesIO
from unittest import mock

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from backend.planimport import build as B
from backend.planimport import gemini as G
from backend.planimport import reading as R
from backend.planimport import validate as V
from backend.auth import get_current_user
from backend.planner.architect.facade import chajja_problems

PX = 20                      # px per ft in the synthetic drawing
IMG_W, IMG_H, OX, OY = 800, 640, 60, 60
TRUTH = {                    # name: (x, y, w, l) in feet, building origin at 0,0
    "living_room": (0, 0, 16, 12), "kitchen": (16, 0, 14, 12), "bedroom": (0, 12, 12, 12), "bathroom": (12, 12, 6, 12), "master_bedroom": (18, 12, 12, 12),
}


def drawing(fmt="PNG", size=(IMG_W, IMG_H)):
    im = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(im)
    for n, (x, y, w, l) in TRUTH.items():
        d.rectangle([OX + x * PX, OY + y * PX, OX + (x + w) * PX, OY + (y + l) * PX], outline="black", width=3)
        d.text((OX + x * PX + 8, OY + y * PX + 8), n, fill="black")
    b = BytesIO()
    im.save(b, fmt)
    return b.getvalue()


def norm(v, total):
    return round(v / total * 1000, 1)


def gem_answer(noise=0.0, dims=True, extra=None):
    rooms = []
    for i, (n, (x, y, w, l)) in enumerate(TRUTH.items()):
        e = noise * (1 if i % 2 else -1)
        r = {"label_text": n.replace("_", " ").upper(), "room_type": n,
             "box": {"xmin": norm(OX + x * PX + e, IMG_W), "ymin": norm(OY + y * PX + e, IMG_H), "xmax": norm(OX + (x + w) * PX + e, IMG_W), "ymax": norm(OY + (y + l) * PX + e, IMG_H)},
             "shape": "rectangular", "provenance": "detected", "confidence": "high"}
        if dims and n in ("living_room", "kitchen", "bedroom", "master_bedroom"):
            r.update(width_ft=float(w), length_ft=float(l), dimension_text=f"{w}'x{l}'")
        rooms.append(r)
    pt = lambda ft_x, ft_y: {"x": norm(OX + ft_x * PX, IMG_W), "y": norm(OY + ft_y * PX, IMG_H)}
    return {
        "is_floor_plan": True, "legible": True, "floor_label": "GROUND FLOOR PLAN", "north_arrow_direction": "up", "rooms": rooms + (extra or []),
        "doors": [{"at": pt(8, 12 * 0 + 12), "is_main_entrance": False, "provenance": "detected", "confidence": "high"},        # living <-> bedroom wall (y=12)
                  {"at": pt(8, 0), "is_main_entrance": True, "width_ft": 4.0, "provenance": "detected", "confidence": "high"},     # main entrance on the north wall
                  {"at": pt(16, 6), "is_main_entrance": False, "provenance": "detected", "confidence": "medium"},                  # living <-> kitchen
                  {"at": pt(15, 26), "is_main_entrance": False, "provenance": "inferred", "confidence": "low"}],                # nowhere: dropped
        "windows": [{"at": pt(0, 18), "width_ft": 4.0, "provenance": "detected", "confidence": "high"},                             # bedroom west wall (outside)
                    {"at": pt(12, 18), "provenance": "detected", "confidence": "medium"}],                                          # bathroom/bedroom shared wall: not outside
        "scale_clues": [{"text": "16'", "kind": "room_dimension", "feet": 16.0, "box": {"xmin": 100, "ymin": 100, "xmax": 120, "ymax": 110}}],
        "unknown": ["scale bar not shown"],
    }


def reading_from(raw=None, **kw):
    info = V.validate_image(drawing())
    return R.normalise_reading(raw or gem_answer(**kw), info, "gemini-3.8-flash")


class Validation(unittest.TestCase):
    def test_png_and_jpeg_accepted(self):
        for fmt, mime in (("PNG", "image/png"), ("JPEG", "image/jpeg")):
            info = V.validate_image(drawing(fmt), mime)
            self.assertEqual((info.mime, info.width, info.height), (mime, IMG_W, IMG_H))

    def test_rejections(self):
        cases = [(b"", "empty_file"), (b"%PDF-1.7 ...", "pdf_not_supported"), (b"just some text " * 50, "bad_type"),
                 (drawing()[:300], "corrupt"), (drawing(size=(100, 100)), "too_small")]
        for data, code in cases:
            with self.assertRaises(V.UploadError) as c:
                V.validate_image(data)
            self.assertEqual(c.exception.code, code)
        with self.assertRaises(V.UploadError) as c:
            V.validate_image(drawing("PNG"), "image/jpeg")
        self.assertEqual(c.exception.code, "type_mismatch")

    def test_size_limit_is_configurable(self):
        with mock.patch.dict(os.environ, {"PLAN_UPLOAD_MAX_MB": "0.5"}):
            with self.assertRaises(V.UploadError) as c:
                V.validate_image(drawing() + b"\0" * 600_000)
            self.assertEqual(c.exception.code, "too_large")


def ok_resp(data):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(data)}]}}]}


class GeminiClient(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"GEMINI_API_KEY": "SECRET-KEY-123", "GEMINI_MODEL": "", "GEMINI_PLAN_MODEL": ""}, clear=False)
        self.env.start()
        self.img = drawing()

    def tearDown(self):
        self.env.stop()

    def test_request_shape(self):
        seen = {}

        def post(model, body, key, timeout):
            seen.update(model=model, body=body, key=key, timeout=timeout)
            return ok_resp(gem_answer())
        G.analyze(self.img, "image/png", post=post, sleep=lambda s: None)
        self.assertEqual(seen["model"], "gemini-3.8-flash")
        cfg = seen["body"]["generationConfig"]
        self.assertEqual(cfg["responseMimeType"], "application/json")
        self.assertIn("rooms", cfg["responseSchema"]["properties"])
        parts = seen["body"]["contents"][0]["parts"]
        self.assertIn("text", parts[0])                                      # instructions first, then the image
        self.assertEqual(parts[1]["inline_data"]["mime_type"], "image/png")
        import base64
        self.assertEqual(base64.b64decode(parts[1]["inline_data"]["data"]), self.img)       # the original bytes, not re-encoded

    def test_model_is_configurable(self):
        with mock.patch.dict(os.environ, {"GEMINI_PLAN_MODEL": "my-model"}):
            self.assertEqual(G.models()[0], "my-model")
            self.assertIn("gemini-3.8-flash", G.models())
        self.assertNotIn("gemini-3.5-flash", G.DEFAULT_MODELS, "deprecated model")

    def test_retry_on_rate_limit_then_success(self):
        calls, waits = [], []

        def post(model, body, key, timeout):
            calls.append(model)
            if len(calls) < 3:
                raise G.GeminiError(429, "quota")
            return ok_resp(gem_answer())
        self.assertTrue(G.analyze(self.img, "image/png", post=post, sleep=waits.append)["rooms"])
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(waits), 2)

    def test_persistent_rate_limit_and_errors_are_plain(self):
        def post(model, body, key, timeout):
            raise G.GeminiError(429, "SECRET-KEY-123 quota")
        with self.assertRaises(G.PlanReadError) as c:
            G.analyze(self.img, "image/png", post=post, sleep=lambda s: None)
        self.assertEqual((c.exception.code, c.exception.status, c.exception.retryable), ("rate_limited", 429, True))
        self.assertNotIn("SECRET-KEY-123", c.exception.message)

    def test_key_rejected_stops_at_once(self):
        calls = []

        def post(model, body, key, timeout):
            calls.append(1)
            raise G.GeminiError(403, "bad key")
        with self.assertRaises(G.PlanReadError) as c:
            G.analyze(self.img, "image/png", post=post, sleep=lambda s: None)
        self.assertEqual(c.exception.code, "key_rejected")
        self.assertEqual(len(calls), 1)

    def test_missing_model_falls_through_to_next(self):
        used = []

        def post(model, body, key, timeout):
            used.append(model)
            if model == "gemini-3.8-flash":
                raise G.GeminiError(404, "no such model")
            return ok_resp(gem_answer())
        G.analyze(self.img, "image/png", post=post, sleep=lambda s: None)
        self.assertEqual(used, ["gemini-3.8-flash", "gemini-3.6-flash"])

    def test_bad_output_network_and_blocked(self):
        for post, code in ((lambda *a, **k: {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}, "bad_output"),
                           (lambda *a, **k: {"candidates": [], "promptFeedback": {"blockReason": "SAFETY"}}, "blocked"),
                           (mock.Mock(side_effect=G.GeminiError(0, "network error: boom")), "network")):
            with self.assertRaises(G.PlanReadError) as c:
                G.analyze(self.img, "image/png", post=post, sleep=lambda s: None)
            self.assertEqual(c.exception.code, code)

    def test_no_key(self):
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}):
            with self.assertRaises(G.PlanReadError) as c:
                G.analyze(self.img, "image/png")
        self.assertEqual((c.exception.code, c.exception.status), ("no_key", 503))


class ReadingCleanup(unittest.TestCase):
    def test_good_reading(self):
        r = reading_from()
        self.assertEqual(len(r["rooms"]), 5)
        self.assertEqual(len(r["doors"]), 4)
        self.assertTrue(all(x["provenance"] in ("detected", "inferred") for x in r["rooms"]))
        self.assertEqual(r["floor_label"], "GROUND FLOOR PLAN")
        self.assertIn("scale bar not shown", r["unknown"])

    def test_untrusted_values_are_bounded(self):
        raw = gem_answer(extra=[
            {"label_text": "<script>alert(1)</script>\x00" + "x" * 300, "room_type": "spaceship", "box": {"xmin": -500, "ymin": 5000, "xmax": 900, "ymax": 4000},
             "shape": "blob", "provenance": "magic", "confidence": "certain", "width_ft": 1e9, "length_ft": float("nan")},
            {"room_type": "bedroom", "box": {"xmin": 1, "ymin": 1, "xmax": 5, "ymax": 5}, "shape": "rectangular", "provenance": "detected", "confidence": "high"},
            "not even a dict"])
        r = R.normalise_reading(raw, V.validate_image(drawing()))
        weird = [x for x in r["rooms"] if x["room_type"] == "other"]
        for x in weird:
            self.assertNotIn("<", x["label"] or "")
            self.assertLessEqual(len(x["label"] or ""), 40)
            self.assertIsNone(x["width_ft"])
            self.assertEqual((x["provenance"], x["confidence"], x["shape"]), ("inferred", "low", "irregular"))
        for x in r["rooms"]:
            for k in ("x0", "y0", "x1", "y1"):
                self.assertTrue(0 <= x["box"][k] <= 1000)
        self.assertFalse([x for x in r["rooms"] if x["box"]["x1"] - x["box"]["x0"] < 12], "tiny boxes are dropped")

    def test_duplicate_outline_merged(self):
        raw = gem_answer()
        dup = json.loads(json.dumps(raw["rooms"][0]))
        dup["confidence"] = "low"
        raw["rooms"].append(dup)
        self.assertEqual(len(R.normalise_reading(raw, V.validate_image(drawing()))["rooms"]), 5)

    def test_client_reading_is_revalidated(self):
        r = reading_from()
        r["rooms"][0]["box"]["x0"] = -9999
        r["rooms"][0]["room_type"] = "<b>"
        c = R.clean_reading(r)
        self.assertTrue(all(0 <= x["box"]["x0"] <= 1000 for x in c["rooms"]))
        with self.assertRaises(B.DraftError):
            R.clean_reading({"image": {"width": 1, "height": 1}})


class Scale(unittest.TestCase):
    def test_printed_dimensions_propose_an_approximate_scale(self):
        s = B.suggest_scale(reading_from())
        self.assertIsNotNone(s["proposal"])
        self.assertAlmostEqual(s["proposal"]["ft_per_px"], 1 / PX, delta=0.004)
        self.assertEqual(s["proposal"]["n"], 8)

    def test_no_dimensions_means_a_reference_is_needed(self):
        s = B.suggest_scale(reading_from(dims=False))
        self.assertIsNone(s["proposal"])
        self.assertTrue(s["needs_reference"])
        with self.assertRaises(B.DraftError):
            B.resolve_scale(reading_from(dims=False), {"mode": "approximate"})

    def test_disagreeing_dimensions_are_not_trusted(self):
        raw = gem_answer()
        raw["rooms"][0]["width_ft"] = 40.0
        s = B.suggest_scale(reading_from(raw))
        self.assertIsNone(s["proposal"])

    def test_user_reference(self):
        r = reading_from(dims=False)
        living = next(x for x in r["rooms"] if x["room_type"] == "living_room")
        sc = B.resolve_scale(r, {"mode": "reference", "room_id": living["id"], "axis": "width", "feet": 16})
        self.assertAlmostEqual(sc["ft_per_px"], 1 / PX, delta=0.001)
        self.assertFalse(sc["approximate"])
        sc = B.resolve_scale(r, {"mode": "overall", "axis": "width", "feet": 30})
        self.assertAlmostEqual(sc["ft_per_px"], 1 / PX, delta=0.001)
        for bad in ({"mode": "reference", "room_id": "nope", "axis": "width", "feet": 10}, {"mode": "overall", "axis": "width", "feet": -3},
                    {"mode": "overall", "axis": "diagonal", "feet": 10}, {"mode": "overall", "axis": "width", "feet": "abc"}, {"mode": "x"}):
            with self.assertRaises(B.DraftError):
                B.resolve_scale(r, bad)


def make_draft(**kw):
    r = reading_from(**kw)
    return B.reading_to_draft(r, B.resolve_scale(r, {"mode": "overall", "axis": "width", "feet": 30}))


class DraftFidelity(unittest.TestCase):
    def test_rooms_match_the_drawing(self):
        d = make_draft(noise=4)            # a few px of noise in Gemini's boxes
        self.assertEqual(len(d["rooms"]), 5)
        by = {r["room_type"]: r for r in d["rooms"]}
        for n, (x, y, w, l) in TRUTH.items():
            r = by[n]
            for got, want in ((r["x"], x), (r["y"], y), (r["width"], w), (r["length"], l)):
                self.assertAlmostEqual(got, want, delta=0.6, msg=f"{n}")
        self.assertEqual(d["check"]["errors"], [])
        self.assertTrue(any("aligned" in a for a in d["adjustments"]), "snapping is reported")

    def test_neighbours_share_walls_after_snapping(self):
        d = make_draft(noise=4)
        by = {r["room_type"]: r for r in d["rooms"]}
        self.assertAlmostEqual(by["living_room"]["x"] + by["living_room"]["width"], by["kitchen"]["x"], places=2)
        self.assertAlmostEqual(by["living_room"]["y"] + by["living_room"]["length"], by["bedroom"]["y"], places=2)

    def test_openings_come_only_from_the_reading(self):
        d = make_draft()
        self.assertEqual(len(d["doors"]), 3)
        self.assertEqual(len(d["windows"]), 1, "the window on an inside wall is dropped, not moved")
        main = [x for x in d["doors"] if x["door_type"] == "main"]
        self.assertEqual(len(main), 1)
        self.assertEqual((main[0]["wall"], main[0]["connects_to"]), ("top", None))
        self.assertEqual(main[0]["width"], 4.0)
        inner = [x for x in d["doors"] if x["door_type"] != "main"]
        self.assertTrue(all(x["connects_to"] for x in inner))
        self.assertTrue(any("not on any room wall" in a for a in d["adjustments"]))
        self.assertTrue(any("between two rooms" in a for a in d["adjustments"]))
        self.assertTrue(all(w["source"] == "detected" for w in d["windows"] + d["doors"]))
        self.assertTrue(any("standard widths" in u for u in d["uncertainties"]))

    def test_scale_error_is_caught_by_validation(self):
        r = reading_from()
        d = B.reading_to_draft(r, B.resolve_scale(r, {"mode": "overall", "axis": "width", "feet": 240}))
        self.assertTrue(d["check"]["errors"])
        with self.assertRaises(B.DraftError):
            B.draft_to_plan(d)

    def test_nothing_is_added_without_the_option(self):
        d = make_draft(raw=None)
        d2 = B.add_assumed_openings(B.reading_to_draft(reading_from(), B.resolve_scale(reading_from(), {"mode": "overall", "axis": "width", "feet": 30})), "South")
        self.assertEqual(len(d["doors"]), 3)
        self.assertEqual(len(d2["doors"]), 3, "doors already in the drawing are kept; none are added")


class AssumedOpenings(unittest.TestCase):
    def test_opt_in_openings_are_labelled(self):
        raw = gem_answer()
        raw["doors"], raw["windows"] = [], []
        r = reading_from(raw)
        d = B.reading_to_draft(r, B.resolve_scale(r, {"mode": "overall", "axis": "width", "feet": 30}))
        self.assertEqual((len(d["doors"]), len(d["windows"])), (0, 0))
        self.assertTrue(any("No doors" in w for w in d["check"]["warnings"]))
        a = B.add_assumed_openings(d, "South")
        self.assertGreaterEqual(len(a["doors"]), 4)
        self.assertEqual(sum(1 for x in a["doors"] if x["door_type"] == "main"), 1)
        self.assertTrue(all(x["source"] == "assumed" for x in a["doors"] + a["windows"]))
        self.assertTrue(any("Assumed" in x for x in a["adjustments"]))
        self.assertEqual(a["check"]["errors"], [])
        main = next(x for x in a["doors"] if x["door_type"] == "main")
        self.assertEqual(main["wall"], "top", "the living room's south wall is inside the house here, so the entrance goes on its own outside wall")
        plan = B.draft_to_plan(a, {"road_side": "South"})
        self.assertEqual(plan["floors"][0]["layout"]["openings"]["circulation"]["connected"], True)


class DraftValidation(unittest.TestCase):
    def test_overlap_and_tiny_rooms(self):
        d = make_draft()
        d["rooms"][1]["x"] -= 3
        self.assertTrue(any("overlap" in e for e in B.validate_draft(d)["errors"]))
        d = make_draft()
        d["rooms"][0]["width"] = 1.0
        self.assertTrue(any("at least" in e for e in B.validate_draft(d)["errors"]))

    def test_unreachable_room_warns(self):
        d = make_draft()
        d["doors"] = [x for x in d["doors"] if x["door_type"] == "main"]
        self.assertTrue(any("Not reachable" in w for w in B.validate_draft(d)["warnings"]))

    def test_client_draft_is_rebuilt_from_typed_fields(self):
        d = make_draft()
        d["rooms"][0]["name"] = "<img onerror=x>" + "A" * 99
        d["rooms"][0]["extra"] = {"evil": 1}
        c = B.clean_draft(d)
        self.assertNotIn("extra", c["rooms"][0])
        self.assertNotIn("<", c["rooms"][0]["name"])
        self.assertLessEqual(len(c["rooms"][0]["name"]), 40)
        for bad in ({"rooms": "x"}, {"rooms": [{"room_type": "nope"}]}, {"rooms": [{"room_type": "bedroom", "x": "1", "y": 0, "width": 5, "length": 5}]}, "str"):
            with self.assertRaises(B.DraftError):
                B.clean_draft(bad)
        d = make_draft()
        d["doors"][0]["connects_to"] = "fake"           # never trusted: recomputed from geometry
        self.assertNotEqual(B.clean_draft(d)["doors"][0]["connects_to"], "fake")


class PlanBuild(unittest.TestCase):
    def test_plan_shape_and_geometry(self):
        d = make_draft(noise=4)
        plan = B.draft_to_plan(d, {"road_side": "North", "architectural_style": "Maharashtrian Wada", "site_margin_ft": 5})
        self.assertEqual(plan["architectural_style"], "Maharashtrian Wada")
        self.assertEqual(plan["road_side"], "North")
        lay = plan["floors"][0]["layout"]
        self.assertEqual(len(lay["rooms"]), 5)
        self.assertAlmostEqual(lay["plot"]["width"], 40.0, delta=0.6)   # 30 ft building + 5 ft margin each side
        self.assertEqual(min(r["x"] for r in lay["rooms"]), 5.0)
        self.assertEqual(len(lay["openings"]["doors"]), 3)
        self.assertEqual(chajja_problems(plan), [])
        self.assertTrue(lay["openings"]["entrance"])
        for r in lay["rooms"]:
            self.assertAlmostEqual(r["x2"] - r["x"], r["width"], places=1)
        for dr in lay["openings"]["doors"]:                              # the drawn segment lies on the wall of its room
            room = next(r for r in lay["rooms"] if r["id"] == dr["room"])
            if dr["wall"] in ("top", "bottom"):
                self.assertEqual(dr["y1"], room["y"] if dr["wall"] == "top" else room["y2"])
        rep = plan["import_report"]
        self.assertIn("scale", rep)
        self.assertTrue(rep["assumptions"])
        json.dumps(plan)

    def test_upload_plan_has_no_invented_rooms(self):
        plan = B.draft_to_plan(make_draft())
        types = sorted(r["room_type"] for r in plan["floors"][0]["layout"]["rooms"])
        self.assertEqual(types, sorted(TRUTH))


class Api(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from backend.main import app
        cls.app = app
        cls.client = TestClient(app)
        user = type("U", (), {"id": 987654, "email": "t@example.com"})()
        app.dependency_overrides[get_current_user] = lambda: user

    @classmethod
    def tearDownClass(cls):
        cls.app.dependency_overrides.pop(get_current_user, None)

    def setUp(self):
        from backend.routers import plan_import
        plan_import._CALLS.clear()
        self.env = mock.patch.dict(os.environ, {"GEMINI_API_KEY": "SECRET-KEY-123"})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def upload(self, data=None, name="plan.png", mime="image/png", **form):
        return self.client.post("/plan-import/analyze", files={"file": (name, data or drawing(), mime)}, data=form)

    def test_requires_login(self):
        self.app.dependency_overrides.pop(get_current_user)
        try:
            for method, path in (("get", "/plan-import/status"), ("post", "/plan-import/analyze"), ("post", "/plan-import/draft"), ("post", "/plan-import/build")):
                self.assertEqual(getattr(self.client, method)(path).status_code, 401, path)
        finally:
            user = type("U", (), {"id": 987654, "email": "t@example.com"})()
            self.app.dependency_overrides[get_current_user] = lambda: user

    def test_consent_is_required_before_gemini(self):
        with mock.patch("backend.planimport.gemini.analyze") as m:
            r = self.upload()
            self.assertEqual(r.status_code, 428)
            self.assertEqual(r.json()["detail"]["code"], "consent_required")
            m.assert_not_called()

    def test_bad_uploads(self):
        self.assertEqual(self.upload(b"%PDF-1.4 xx", "a.pdf", "application/pdf", consent="true").json()["detail"]["code"], "pdf_not_supported")
        self.assertEqual(self.upload(b"hello world" * 100, "a.png", "image/png", consent="true").json()["detail"]["code"], "bad_type")

    def test_no_key_message_and_manual_fallback(self):
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "", "GOOGLE_API_KEY": ""}):
            r = self.upload(consent="true")
            self.assertEqual((r.status_code, r.json()["detail"]["code"]), (503, "no_key"))
            m = self.upload(manual="true")
            self.assertEqual(m.status_code, 200)
            self.assertEqual(m.json()["reading"]["rooms"], [])

    def test_full_flow_with_mocked_gemini(self):
        with mock.patch("backend.planimport.gemini.analyze", return_value=gem_answer(noise=3)) as m:
            r = self.upload(consent="true")
        self.assertEqual(r.status_code, 200, r.text)
        m.assert_called_once()
        out = r.json()
        self.assertNotIn("SECRET-KEY-123", r.text)
        self.assertEqual(out["source"], "gemini")
        self.assertIsNotNone(out["scale"]["proposal"])
        # a scale must be chosen: the draft endpoint refuses to guess
        bad = self.client.post("/plan-import/draft", json={"reading": out["reading"], "scale": {"mode": "reference", "feet": "?"}})
        self.assertEqual(bad.status_code, 422)
        d = self.client.post("/plan-import/draft", json={"reading": out["reading"], "scale": {"mode": "approximate"}})
        self.assertEqual(d.status_code, 200, d.text)
        draft = d.json()["draft"]
        self.assertTrue(draft["scale"]["approximate"])
        self.assertEqual(draft["check"]["errors"], [])
        # the user edits a room, then builds
        draft["rooms"][0]["name"] = "Hall"
        b = self.client.post("/plan-import/build", json={"draft": draft, "road_side": "East", "architectural_style": "Traditional Indian", "site_margin_ft": 4})
        self.assertEqual(b.status_code, 200, b.text)
        plan = b.json()["plan"]
        self.assertEqual((plan["architectural_style"], plan["road_side"]), ("Traditional Indian", "East"))
        self.assertIn("Hall", [r["name"] for r in plan["floors"][0]["layout"]["rooms"]])
        # structural errors block the build with a list of reasons
        draft["rooms"][1]["x"] -= 4
        e = self.client.post("/plan-import/build", json={"draft": draft})
        self.assertEqual(e.status_code, 422)
        self.assertTrue(any("overlap" in x for x in e.json()["detail"]["details"]))

    def test_gemini_errors_reach_the_user_plainly(self):
        err = G.PlanReadError("rate_limited", "Gemini is rate-limiting requests.", 429, True)
        with mock.patch("backend.planimport.gemini.analyze", side_effect=err):
            r = self.upload(consent="true")
        self.assertEqual((r.status_code, r.json()["detail"]["code"], r.json()["detail"]["retryable"]), (429, "rate_limited", True))

    def test_per_user_hourly_limit(self):
        with mock.patch.dict(os.environ, {"PLAN_IMPORT_PER_HOUR": "2"}), mock.patch("backend.planimport.gemini.analyze", return_value=gem_answer()):
            codes = [self.upload(consent="true").status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])

    def test_oversized_json_refused(self):
        r = self.client.post("/plan-import/build", json={"draft": {"rooms": [], "pad": "x" * 500_000}})
        self.assertEqual(r.status_code, 413)

    def test_status_never_returns_the_key(self):
        r = self.client.get("/plan-import/status")
        self.assertTrue(r.json()["gemini_available"])
        self.assertNotIn("SECRET-KEY-123", r.text)


if __name__ == "__main__":
    unittest.main()
