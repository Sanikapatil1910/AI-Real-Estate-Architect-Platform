"""Backend for the browser tests: real app + a throw-away SQLite database, with Gemini replaced by a canned answer (no network, no key).
Run:  python -m tests.e2e_server [port]"""
import os
import sys
import tempfile

os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/e2e.db")
os.environ["GEMINI_API_KEY"] = "e2e-not-a-real-key"
os.environ.setdefault("PLAN_IMPORT_PER_HOUR", "200")

from unittest import mock  # noqa: E402

import uvicorn  # noqa: E402

from backend.planimport import gemini  # noqa: E402
from tests.test_plan_import import gem_answer  # noqa: E402

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    with mock.patch.object(gemini, "analyze", lambda image, mime, **k: gem_answer(noise=3)):
        from backend.main import app
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
