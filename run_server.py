import sys
from pathlib import Path

_proj = Path(__file__).resolve().parent
_local_deps = _proj / "_pydeps"
if _local_deps.exists():
    sys.path.insert(0, str(_local_deps))

import uvicorn
from backend.main import app

if __name__ == "__main__":
    print("App loaded OK, running uvicorn on http://127.0.0.1:8000")
    sys.stdout.flush()
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
