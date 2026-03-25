from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version


PACKAGE_NAME = "newscast-navigator-backend"
FALLBACK_APP_VERSION = "0.2.0"


def get_app_version() -> str:
    try:
        return version(PACKAGE_NAME)
    except PackageNotFoundError:
        return FALLBACK_APP_VERSION

