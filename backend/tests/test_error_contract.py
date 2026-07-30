from __future__ import annotations

from collections.abc import Callable

from fastapi import HTTPException
import pytest

from app.main import app


def _with_test_route(path: str, endpoint: Callable[[], None]) -> object:
    app.add_api_route(path, endpoint, methods=["GET"])
    return app.router.routes[-1]


def test_unknown_route_uses_generic_not_found_contract(client) -> None:
    response = client.get("/api/v1/route-that-does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_unsupported_method_uses_generic_method_not_allowed_contract(client) -> None:
    response = client.delete("/api/v1/auth/me")

    assert response.status_code == 405
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"


@pytest.mark.parametrize(
    ("status_code", "expected_code"),
    [
        (400, "BAD_REQUEST"),
        (401, "AUTH_REQUIRED"),
        (403, "FORBIDDEN"),
        (404, "NOT_FOUND"),
        (405, "METHOD_NOT_ALLOWED"),
        (409, "CONFLICT"),
        (422, "VALIDATION_ERROR"),
        (429, "RATE_LIMITED"),
        (500, "HTTP_ERROR"),
    ],
)
def test_generic_http_exception_maps_status_to_safe_code(
    client,
    status_code: int,
    expected_code: str,
) -> None:
    path = f"/__test__/generic-http-error/{status_code}"

    def fail() -> None:
        raise HTTPException(status_code=status_code, detail="Синтетическая ошибка")

    route = _with_test_route(path, fail)
    try:
        response = client.get(path)
    finally:
        app.router.routes.remove(route)

    assert response.status_code == status_code
    assert response.json()["error"]["code"] == expected_code


def test_generic_http_exception_preserves_protocol_headers(client) -> None:
    path = "/__test__/generic-http-error/headers"

    def fail() -> None:
        raise HTTPException(
            status_code=429,
            detail="Синтетическое ограничение",
            headers={"Retry-After": "17"},
        )

    route = _with_test_route(path, fail)
    try:
        response = client.get(path)
    finally:
        app.router.routes.remove(route)

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
    assert response.headers["Retry-After"] == "17"
