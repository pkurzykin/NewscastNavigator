from __future__ import annotations

import bcrypt
from sqlalchemy import select

from app.db.models import User
from app.db.session import SessionLocal


def test_legacy_bcrypt_password_login_rehashes_to_pbkdf2(client) -> None:
    with SessionLocal() as db:
        user = User(
            username="legacy_admin",
            password_hash=bcrypt.hashpw(b"secret123", bcrypt.gensalt()).decode("utf-8"),
            role="admin",
            is_active=True,
        )
        db.add(user)
        db.commit()

    response = client.post(
        "/api/v1/auth/login",
        json={"username": "legacy_admin", "password": "secret123"},
    )
    assert response.status_code == 200, response.text

    with SessionLocal() as db:
        updated_user = db.execute(
            select(User).where(User.username == "legacy_admin")
        ).scalar_one()
        assert updated_user.password_hash.startswith("pbkdf2_sha256$")
