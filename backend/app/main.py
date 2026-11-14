from __future__ import annotations

import logging
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from . import models  # Register model metadata before creating the schema.
from .config import settings
from .database import Base, SessionLocal, engine

# Send application logs to the console, including request and error details.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sports-watchability-api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Create any tables that are missing before the API starts accepting requests.
    Base.metadata.create_all(bind=engine)
    yield
    # Release database connections when the server shuts down.
    engine.dispose()


app = FastAPI(title="Sports Watchability Index API", lifespan=lifespan)
# Allow browser clients on other origins to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_log(request: Request, call_next):
    # Log each completed request with its method, path, and response status.
    response = await call_next(request)
    logger.info("%s %s %s", request.method, request.url.path, response.status_code)
    return response


@app.exception_handler(Exception)
async def unhandled_error(_: Request, error: Exception) -> JSONResponse:
    # Return a consistent error shape; include stack details only during development.
    logger.error(
        "Unhandled API error",
        exc_info=(type(error), error, error.__traceback__),
    )
    payload = {"message": str(error) or "Internal Server Error"}
    if settings.is_development:
        payload["stack"] = "".join(traceback.format_exception(error))
    return JSONResponse(status_code=500, content={"error": payload})


@app.exception_handler(HTTPException)
async def http_error(_: Request, error: HTTPException) -> JSONResponse:
    # Keep intentional HTTP errors in the same JSON format as other API errors.
    message = error.detail if isinstance(error.detail, str) else "Request failed"
    return JSONResponse(status_code=error.status_code, content={"error": {"message": message}})


@app.get("/api/health")
def health() -> dict[str, str]:
    # Report that the API is responding and include the current UTC time.
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}


@app.get("/api/health/database", response_model=None)
def database_health() -> JSONResponse | dict[str, str]:
    # Run a lightweight query to verify that the configured database is reachable.
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
        return {"status": "ok", "message": "Database connection has been established successfully."}
    except (SQLAlchemyError, OSError, ValueError) as error:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unavailable",
                "message": "Unable to connect to the database.",
                "error": str(error),
            },
        )
