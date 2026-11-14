"""Start the API with python -m backend."""

import uvicorn

from .app.config import settings

if __name__ == "__main__":
    # Bind to all network interfaces so the server can be reached from the local machine.
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=settings.port)
