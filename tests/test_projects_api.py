"""Saved projects: ownership, validation, limits, summaries, and that signup / login / me still work (real JWT flow on a throw-away database)."""
import os
import tempfile
import unittest
from unittest import mock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base, get_db
from backend.main import app

PLAN = {"building_type": "G+1", "architectural_style": "Maharashtrian Wada",
        "floors": [{"floor": "Ground Floor", "layout": {"plot": {"width": 30.0, "length": 40.0}, "rooms": [{"id": "a"}, {"id": "b"}, {"id": "c"}]}},
                   {"floor": "First Floor", "layout": {"rooms": [{"id": "d"}]}}]}


class ProjectsApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=eng)
        Session = sessionmaker(bind=eng, autoflush=False, autocommit=False)

        def override():
            db = Session()
            try:
                yield db
            finally:
                db.close()
        cls.prev = app.dependency_overrides.get(get_db)
        app.dependency_overrides[get_db] = override
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.pop(get_db, None)
        if cls.prev:
            app.dependency_overrides[get_db] = cls.prev

    def signup(self, email):
        r = self.client.post("/auth/signup", json={"full_name": "Test User", "email": email, "password": "secret12", "role": "home_owner"})
        self.assertEqual(r.status_code, 201, r.text)
        t = self.client.post("/auth/login", json={"email": email, "password": "secret12"})
        self.assertEqual(t.status_code, 200)
        return {"Authorization": "Bearer " + t.json()["access_token"]}

    def test_auth_still_works_and_routes_are_protected(self):
        h = self.signup("auth@example.com")
        me = self.client.get("/auth/me", headers=h)
        self.assertEqual(me.json()["email"], "auth@example.com")
        self.assertEqual(self.client.post("/auth/login", json={"email": "auth@example.com", "password": "wrong-one"}).status_code, 401)
        for method, path in (("get", "/projects"), ("post", "/projects"), ("get", "/projects/1"), ("delete", "/projects/1")):
            self.assertEqual(getattr(self.client, method)(path).status_code, 401, path)

    def test_crud_summary_and_ownership(self):
        a, b = self.signup("a@example.com"), self.signup("b@example.com")
        self.assertEqual(self.client.get("/projects", headers=a).json(), [], "empty state: a new user has no projects")
        r = self.client.post("/projects", headers=a, json={"name": "  My <b>Wada</b> house ", "kind": "generated", "style": "wada", "data": {"plan": PLAN, "request": {"plot_width": 30}}})
        self.assertEqual(r.status_code, 201, r.text)
        p = r.json()
        self.assertEqual(p["style"], "Maharashtrian Wada")
        self.assertNotIn("<", p["name"])
        self.assertEqual(p["summary"]["rooms"], 4)
        self.assertEqual(p["summary"]["floors"], 2)
        self.assertEqual(p["summary"]["plot"], "30 x 40 ft")
        self.assertEqual(p["data"]["request"], {"plot_width": 30})
        lst = self.client.get("/projects", headers=a).json()
        self.assertEqual([x["id"] for x in lst], [p["id"]])
        self.assertNotIn("data", lst[0], "list view is light")
        # the other user cannot see, change or delete it
        self.assertEqual(self.client.get("/projects", headers=b).json(), [])
        for method in ("get", "delete"):
            self.assertEqual(getattr(self.client, method)(f"/projects/{p['id']}", headers=b).status_code, 404)
        self.assertEqual(self.client.put(f"/projects/{p['id']}", headers=b, json={"name": "mine now"}).status_code, 404)
        # update
        u = self.client.put(f"/projects/{p['id']}", headers=a, json={"name": "Renamed", "style": "Traditional Indian"})
        self.assertEqual((u.json()["name"], u.json()["style"]), ("Renamed", "Traditional Indian"))
        self.assertEqual(self.client.get(f"/projects/{p['id']}", headers=a).json()["data"]["plan"]["building_type"], "G+1")
        self.assertEqual(self.client.delete(f"/projects/{p['id']}", headers=a).status_code, 204)
        self.assertEqual(self.client.get(f"/projects/{p['id']}", headers=a).status_code, 404)

    def test_validation_and_limits(self):
        h = self.signup("v@example.com")
        for body in ({"name": "", "data": {"plan": PLAN}}, {"name": "x", "data": "nope"}, {"name": "x", "data": {"plan": {"floors": "x"}}}, {"name": "x", "data": {}}):
            self.assertEqual(self.client.post("/projects", headers=h, json=body).status_code, 422, body)
        self.assertEqual(self.client.post("/projects", headers=h, json={"name": "big", "data": {"plan": PLAN, "pad": "x" * 7_000_000}}).status_code, 413)
        with mock.patch.dict(os.environ, {"MAX_PROJECTS_PER_USER": "2"}):
            codes = [self.client.post("/projects", headers=h, json={"name": f"p{i}", "data": {"plan": PLAN}}).status_code for i in range(3)]
        self.assertEqual(codes, [201, 201, 409])

    def test_upload_kind_and_old_style_names(self):
        h = self.signup("u@example.com")
        r = self.client.post("/projects", headers=h, json={"name": "From my drawing", "kind": "upload", "style": "Minimalistic Luxury", "data": {"plan": PLAN, "draft": {"rooms": []}}})
        self.assertEqual((r.json()["kind"], r.json()["style"], r.json()["summary"]["source"]), ("upload", "Modern Minimalistic", "uploaded plan"))


if __name__ == "__main__":
    unittest.main()
