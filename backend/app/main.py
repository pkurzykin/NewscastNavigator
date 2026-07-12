from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.auth import router as auth_router
from app.api.routes.admin import router as admin_router
from app.api.routes.health import router as health_router
from app.core.config import get_settings
from app.core.version import get_app_version
from app.services.runtime_setup import initialize_runtime


@asynccontextmanager
async def runtime_lifespan(_app: FastAPI):
    initialize_runtime()
    yield


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=get_app_version(),
        lifespan=runtime_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(HTTPException)
    async def domain_http_error(_request: Request, exc: HTTPException) -> JSONResponse:
        if isinstance(exc.detail, dict) and "code" in exc.detail:
            error = {
                "code": str(exc.detail["code"]),
                "message": str(exc.detail.get("message", "Операция не выполнена")),
                "details": exc.detail.get("details", {}),
            }
        else:
            code = "AUTH_REQUIRED" if exc.status_code == 401 else "FORBIDDEN" if exc.status_code == 403 else "INVALID_TRANSITION"
            error = {"code": code, "message": str(exc.detail), "details": {}}
        return JSONResponse(status_code=exc.status_code, content={"error": error})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {
                "location": [str(part) for part in item["loc"]],
                "message": item["msg"],
                "type": item["type"],
            }
            for item in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Запрос не прошёл проверку",
                    "details": {"errors": errors},
                }
            },
        )

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(admin_router)

    return app


app = create_app()
