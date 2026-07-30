from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.api.routes.auth import router as auth_router
from app.api.routes.admin import router as admin_router
from app.api.routes.captionpanels import router as captionpanels_router
from app.api.routes.corrections import router as corrections_router
from app.api.routes.external_approval import router as external_approval_router
from app.api.routes.scenario import router as scenario_router
from app.api.routes.health import router as health_router
from app.api.routes.history import router as history_router
from app.api.routes.notifications import router as notifications_router
from app.api.routes.production import router as production_router
from app.api.routes.stories import router as stories_router
from app.api.routes.workflow import router as workflow_router
from app.core.config import get_settings
from app.core.version import get_app_version
from app.services.runtime_setup import initialize_runtime


GENERIC_HTTP_ERROR_CODES = {
    400: "BAD_REQUEST",
    401: "AUTH_REQUIRED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
}


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
            code = GENERIC_HTTP_ERROR_CODES.get(exc.status_code, "HTTP_ERROR")
            error = {"code": code, "message": str(exc.detail), "details": {}}
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": error},
            headers=exc.headers,
        )

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
    app.include_router(stories_router)
    app.include_router(scenario_router)
    app.include_router(history_router)
    app.include_router(captionpanels_router)
    app.include_router(workflow_router)
    app.include_router(production_router)
    app.include_router(corrections_router)
    app.include_router(external_approval_router)
    app.include_router(notifications_router)

    return app


app = create_app()
