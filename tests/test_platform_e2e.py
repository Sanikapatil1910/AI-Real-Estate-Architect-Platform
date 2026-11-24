"""Browser tests of the product shell: landing, signup/login/logout, protected routes, dashboard, the
floor-plan upload workflow (Gemini replaced by a canned answer), saved projects, and responsive layout.

Starts `tests/e2e_server.py` (real backend, throw-away SQLite DB, mocked Gemini) and the vite dev server
unless they are already running.  Skipped when playwright / node_modules / a browser are missing.

    python -m unittest tests.test_platform_e2e -v
"""
import os
import re
import shutil
import subprocess
import sys
import time
import unittest
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = "http://127.0.0.1:5173"
API = "http://127.0.0.1:8000"
GL = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]


def _up(url):
    try:
        urllib.request.urlopen(url, timeout=2)
        return True
    except Exception:
        return False


def _wait(url, secs=90):
    end = time.time() + secs
    while time.time() < end:
        if _up(url):
            return True
        time.sleep(1.5)
    return False


class ButtonWiring(unittest.TestCase):
    """Static audit: every <button> in the React source does something (onClick, submit, or is a tab/toggle handled by the parent)."""

    def test_every_button_has_a_handler(self):
        bad = []
        for f in (ROOT / "frontend-react" / "src").rglob("*.tsx"):
            text = f.read_text(encoding="utf-8")
            for m in re.finditer(r"<button\b(.*?)>", text, flags=re.S):
                tag = m.group(1)
                if not re.search(r"onClick=|type=\"submit\"|\{\.\.\.", tag):
                    line = text[: m.start()].count("\n") + 1
                    bad.append(f"{f.name}:{line}")
        self.assertEqual(bad, [], f"buttons without a handler: {bad}")

    def test_every_in_app_link_target_is_a_known_route(self):
        known = {"/", "/login", "/signup", "/app", "/app/create", "/app/upload", "/app/settings", "/app/vr"}   # /app/vr = the VR walk-through list (route added with the WebXR viewer)
        bad = []
        for f in (ROOT / "frontend-react" / "src").rglob("*.tsx"):
            for m in re.finditer(r"<Link\b[^>]*?\bto=\"([^\"]+)\"", f.read_text(encoding="utf-8")):
                if m.group(1) not in known:
                    bad.append(f"{f.name}:{m.group(1)}")
        self.assertEqual(bad, [], bad)


class PlatformE2E(unittest.TestCase):
    procs = []

    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright  # noqa: F401
        except Exception as exc:
            raise unittest.SkipTest(f"playwright unavailable: {exc}")
        if not (ROOT / "frontend-react" / "node_modules").exists():
            raise unittest.SkipTest("frontend-react/node_modules missing (run npm install)")
        if not _up(API + "/health"):
            cls.procs.append(subprocess.Popen([sys.executable, "-m", "tests.e2e_server", "8000"], cwd=ROOT, env={**os.environ},
                                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True))
            if not _wait(API + "/health", 40):
                cls.tearDownClass()
                raise unittest.SkipTest("the e2e backend did not start")
        if not _up(WEB + "/"):
            npx = shutil.which("npx")
            if not npx:
                raise unittest.SkipTest("npx not found")
            cls.procs.append(subprocess.Popen([npx, "vite", "--port", "5173", "--host", "127.0.0.1", "--strictPort"], cwd=ROOT / "frontend-react",
                                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True))
            if not _wait(WEB + "/", 90):
                cls.tearDownClass()
                raise unittest.SkipTest("the dev server did not start")
        from playwright.sync_api import sync_playwright
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(args=GL)
        import tests.test_plan_import as tpi
        cls.tmp = Path(__import__("tempfile").mkdtemp())
        (cls.tmp / "plan.png").write_bytes(tpi.drawing("PNG"))
        (cls.tmp / "plan.jpg").write_bytes(tpi.drawing("JPEG"))
        (cls.tmp / "notes.txt").write_text("not an image")
        (cls.tmp / "fake.png").write_bytes(b"this is not a png")
        cls.email = f"e2e-{uuid.uuid4().hex[:8]}@example.com"

    @classmethod
    def tearDownClass(cls):
        try:
            cls.browser.close()
            cls.pw.stop()
        except Exception:
            pass
        for p in cls.procs:
            try:
                os.killpg(p.pid, 15)
            except Exception:
                pass
        cls.procs = []

    # ---- helpers -------------------------------------------------------------------------------------------------
    def page(self, w=1366, h=860):
        pg = self.browser.new_page(viewport={"width": w, "height": h})
        pg.set_default_timeout(120000)
        pg.errors = []
        pg.on("pageerror", lambda e: pg.errors.append("PAGEERR " + str(e)[:300]))
        pg.on("console", lambda m: pg.errors.append("CONSOLE " + m.text[:300]) if m.type == "error" and "401" not in m.text and "409" not in m.text
              and "Failed to load resource" not in m.text else None)
        self.addCleanup(pg.close)
        return pg

    def signup(self, pg, email=None, name="Asha Patil"):
        email = email or f"e2e-{uuid.uuid4().hex[:8]}@example.com"
        pg.goto(WEB + "/signup")
        pg.fill("#nm", name)
        pg.fill("#em", email)
        pg.fill("#pw", "secret12")
        pg.click("[data-testid=auth-submit]")
        pg.wait_for_url("**/app")
        return email

    def read_plan(self, pg, file="plan.png"):
        pg.goto(WEB + "/app/upload")
        pg.set_input_files("[data-testid=file-input]", str(self.tmp / file))
        pg.check("[data-testid=consent]")
        pg.click("[data-testid=read-gemini]")
        pg.wait_for_selector("[data-testid=scale-step]")
        pg.click("[data-testid=scale-continue]")
        pg.wait_for_selector("[data-testid=review-step]")

    def no_overflow(self, pg, w):
        self.assertLessEqual(pg.evaluate("document.documentElement.scrollWidth"), w, "horizontal overflow")

    # ---- landing + auth ------------------------------------------------------------------------------------------
    def test_landing_page(self):
        pg = self.page()
        pg.goto(WEB + "/")
        self.assertIn("Your Vision. Your Home.", pg.inner_text("h1"))
        self.assertIn("Designed with AI.", pg.inner_text("h1"))
        pg.click("[data-testid=cta-start]")
        pg.wait_for_url("**/signup**")
        pg.goto(WEB + "/")
        pg.click("[data-testid=cta-upload]")
        pg.wait_for_url("**/login**")            # not signed in: protected route sends to login, remembering where to go
        self.assertIn("next=%2Fapp%2Fupload", pg.url)
        self.assertEqual(pg.errors, [])

    def test_protected_routes_redirect_and_return(self):
        pg = self.page()
        pg.goto(WEB + "/app/create")
        pg.wait_for_url("**/login**")
        self.assertIn("next=", pg.url)
        pg.click("text=Create an account")
        pg.wait_for_url("**/signup**")
        pg.fill("#nm", "Redirect Tester")
        pg.fill("#em", f"e2e-{uuid.uuid4().hex[:8]}@example.com")
        pg.fill("#pw", "secret12")
        pg.click("[data-testid=auth-submit]")
        pg.wait_for_url("**/app/create")        # returns to where the visitor was headed

    def test_signup_login_logout_and_errors(self):
        pg = self.page()
        pg.goto(WEB + "/signup")
        pg.click("[data-testid=auth-submit]")
        self.assertIn("name", pg.inner_text("[data-testid=auth-error]").lower())
        pg.fill("#nm", "Asha Patil")
        pg.fill("#em", "not-an-email")
        pg.click("[data-testid=auth-submit]")
        self.assertIn("valid email", pg.inner_text("[data-testid=auth-error]"))
        pg.fill("#em", self.email)
        pg.fill("#pw", "123")
        pg.click("[data-testid=auth-submit]")
        self.assertIn("6 characters", pg.inner_text("[data-testid=auth-error]"))
        pg.fill("#pw", "secret12")
        pg.click("[data-testid=auth-submit]")
        pg.wait_for_url("**/app")
        self.assertIn("Asha", pg.inner_text("[data-testid=user-name]"))
        pg.wait_for_selector("[data-testid=empty-projects]")               # fresh account: honest empty state, no fake projects
        self.assertEqual(pg.locator("[data-testid=project-card]").count(), 0)
        pg.reload()
        pg.wait_for_selector("[data-testid=user-name]")                      # session survives a reload
        pg.click("[data-testid=logout]")
        pg.wait_for_url(WEB + "/")
        pg.goto(WEB + "/app")
        pg.wait_for_url("**/login**")
        # duplicate email is refused, wrong password is refused with a plain message
        pg.goto(WEB + "/signup")
        pg.fill("#nm", "Someone Else")
        pg.fill("#em", self.email)
        pg.fill("#pw", "secret12")
        pg.click("[data-testid=auth-submit]")
        pg.wait_for_selector("[data-testid=auth-error]")
        pg.goto(WEB + "/login")
        pg.fill("#em", self.email)
        pg.fill("#pw", "wrong-password")
        pg.click("[data-testid=auth-submit]")
        self.assertIn("not correct", pg.inner_text("[data-testid=auth-error]"))
        pg.fill("#pw", "secret12")
        pg.click("[data-testid=auth-submit]")
        pg.wait_for_url("**/app")
        self.assertEqual(pg.errors, [])

    def test_unknown_route_is_a_not_found_page(self):
        pg = self.page()
        pg.goto(WEB + "/no/such/page")
        self.assertIn("not", pg.inner_text("body").lower())

    # ---- upload workflow -----------------------------------------------------------------------------------------
    def test_upload_flow_end_to_end_and_save(self):
        pg = self.page()
        self.signup(pg)
        pg.click("[data-testid=dash-upload]")
        pg.wait_for_url("**/app/upload")
        # consent is required before the (paid) Gemini call
        pg.set_input_files("[data-testid=file-input]", str(self.tmp / "plan.png"))
        self.assertTrue(pg.is_disabled("[data-testid=read-gemini]"))
        pg.check("[data-testid=consent]")
        self.assertFalse(pg.is_disabled("[data-testid=read-gemini]"))
        pg.click("[data-testid=read-gemini]")
        pg.wait_for_selector("[data-testid=scale-step]")
        pg.click("[data-testid=scale-continue]")
        pg.wait_for_selector("[data-testid=review-editor]")
        self.assertGreaterEqual(pg.locator("[data-testid=rooms-table] tbody tr").count(), 4)
        pg.click("[data-testid=add-room]")                                      # the reader never invents; the user may add
        n = pg.locator("[data-testid=rooms-table] tbody tr").count()
        self.assertGreaterEqual(n, 6)
        pg.click("[data-testid=build-3d]")
        pg.wait_for_selector("[data-testid=model-step]")
        pg.wait_for_selector("[data-testid=design-panel]")
        pg.wait_for_selector("[data-testid=twin-canvas]")
        self.assertTrue(pg.get_by_text("Download 3D model (.glb)").first.is_visible())
        with pg.expect_download() as dl:
            pg.get_by_text("Download 3D model (.glb)").first.click()
        path = dl.value.path()
        with open(path, "rb") as fh:
            self.assertEqual(fh.read(4), b"glTF")
        pg.click("[data-testid=save-upload]")
        pg.wait_for_function("document.querySelector('[role=status]') && /saved/i.test(document.querySelector('[role=status]').innerText)")
        pg.goto(WEB + "/app")
        pg.wait_for_selector("[data-testid=project-card]")
        self.assertIn("From uploaded plan", pg.inner_text("[data-testid=project-card]"))
        self.assertEqual(pg.errors, [])

    def test_upload_bad_files_and_manual_mode(self):
        pg = self.page()
        self.signup(pg)
        pg.goto(WEB + "/app/upload")
        pg.set_input_files("[data-testid=file-input]", str(self.tmp / "notes.txt"))
        self.assertTrue(pg.is_visible("[data-testid=file-error]"))
        pg.set_input_files("[data-testid=file-input]", str(self.tmp / "fake.png"))
        pg.check("[data-testid=consent]") if pg.is_visible("[data-testid=consent]") else None
        if pg.is_visible("[data-testid=read-gemini]") and not pg.is_disabled("[data-testid=read-gemini]"):
            pg.click("[data-testid=read-gemini]")
            pg.wait_for_selector("[data-testid=upload-error], [data-testid=file-error]")
        else:
            self.assertTrue(pg.is_visible("[data-testid=file-error]"))
        # a JPEG works as well as a PNG, and manual mode needs no Gemini and no consent
        pg.goto(WEB + "/app/upload")
        pg.set_input_files("[data-testid=file-input]", str(self.tmp / "plan.jpg"))
        pg.click("[data-testid=read-manual]")
        pg.wait_for_selector("[data-testid=scale-step], [data-testid=review-step]")
        self.assertEqual(pg.errors, [])

    # ---- generator + saved projects ------------------------------------------------------------------------------
    def test_generate_save_open_restyle_rename_delete(self):
        pg = self.page()
        self.signup(pg)
        pg.click("[data-testid=dash-create]")
        pg.wait_for_url("**/app/create")
        pg.select_option("[data-testid=frontage-select]", "width")           # the planner never guesses the road side
        pg.get_by_text("Generate 4 Architectural Concepts").click()
        pg.wait_for_selector("[data-testid=save-project]", timeout=420000)
        self.assertNotRegex(pg.inner_text("main, body"), r"\b\d+(\.\d+)?\s*/\s*100\b")       # no numerical concept score anywhere
        pg.locator("[data-testid=save-project]").first.click()
        pg.wait_for_selector("[data-testid=save-msg]")
        pg.goto(WEB + "/app")
        pg.wait_for_selector("[data-testid=project-card]")
        pg.get_by_role("button", name="Open").first.click()
        pg.wait_for_url("**/app/project/**")
        pg.wait_for_selector("[data-testid=twin-canvas]", timeout=240000)
        # restyle with the design studio, save, reload: the choice persists
        pg.wait_for_selector("[data-testid=style-picker]")
        pg.click("[data-testid=style-maharashtrian_wada]")
        self.assertTrue(pg.is_visible("[data-testid=design-panel]"))
        pg.fill("[data-testid=project-name]", "Patil residence")
        pg.click("[data-testid=project-save]")
        pg.wait_for_selector("text=Saved")
        pg.reload()
        pg.wait_for_selector("[data-testid=project-name]")
        self.assertEqual(pg.input_value("[data-testid=project-name]"), "Patil residence")
        self.assertIn("Wada", pg.inner_text("[data-testid=project-style]"))
        pg.click("[data-testid=tab-plan]")
        pg.wait_for_selector("svg")
        pg.click("[data-testid=tab-notes]")
        # another user can never open it
        other = self.page()
        self.signup(other)
        other.goto(pg.url)
        other.wait_for_selector("text=/does not exist/i")
        # delete
        pg.get_by_role("button", name="Delete").first.click()
        pg.get_by_role("button", name="Yes, delete").click()
        pg.wait_for_url("**/app")
        pg.wait_for_selector("[data-testid=empty-projects]")
        self.assertEqual(pg.errors, [])

    def test_settings_page(self):
        pg = self.page()
        self.signup(pg, name="Settings Person")
        pg.goto(WEB + "/app/settings")
        self.assertIn("Settings Person", pg.inner_text("[data-testid=set-name]"))
        pg.click("[data-testid=settings-logout]")
        pg.wait_for_url(WEB + "/")

    # ---- responsive ----------------------------------------------------------------------------------------------
    def test_responsive_no_horizontal_scroll_and_usable_viewer(self):
        for w, h in ((390, 844), (820, 1180), (1366, 860)):
            with self.subTest(width=w):
                pg = self.page(w, h)
                for path in ("/", "/login", "/signup"):
                    pg.goto(WEB + path)
                    pg.wait_for_timeout(300)
                    self.no_overflow(pg, w)
                self.signup(pg)
                for path in ("/app", "/app/create", "/app/upload", "/app/settings"):
                    pg.goto(WEB + path)
                    pg.wait_for_timeout(500)
                    self.no_overflow(pg, w)
                self.read_plan(pg)
                self.no_overflow(pg, w)
                pg.click("[data-testid=build-3d]")
                pg.wait_for_selector("[data-testid=twin-canvas]")
                pg.wait_for_selector("[data-testid=design-panel]")
                box = pg.locator("[data-testid=twin-canvas]").first.bounding_box()
                self.assertGreaterEqual(box["width"], min(w, 360) - 40)
                self.assertGreaterEqual(box["height"], 260)
                self.no_overflow(pg, w)
                self.assertEqual(pg.errors, [])


if __name__ == "__main__":
    unittest.main()
