"""Serve the production React build beside the API on a single origin."""
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def mount_frontend(app: FastAPI, directory: str) -> None:
    if not directory:
        return
    root = Path(directory).resolve()
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError("FRONTEND_DIST must contain the built frontend index.html")

    def login_shell():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    # BrowserRouter needs the shell on direct visits/refreshes. API and missing
    # asset paths must retain real 404s instead of returning HTML with status 200.
    for route in ("/", "/citizen", "/responder", "/admin"):
        app.add_api_route(route, login_shell, methods=["GET"], include_in_schema=False)
    app.mount("/", StaticFiles(directory=root), name="frontend")
