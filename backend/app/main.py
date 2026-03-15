from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.auth import router as auth_router
from app.api.routes.editor import router as editor_router
from app.api.routes.exports import router as exports_router
from app.api.routes.health import router as health_router
from app.api.routes.projects import router as projects_router
from app.api.routes.users import router as users_router
from app.api.routes.workspace import router as workspace_router
from app.core.config import get_settings
from app.services.bootstrap import initialize_schema_and_seed


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(users_router)
    app.include_router(projects_router)
    app.include_router(editor_router)
    app.include_router(workspace_router)
    app.include_router(exports_router)

    @app.on_event("startup")
    def _startup() -> None:
        initialize_schema_and_seed()

    return app


app = create_app()
