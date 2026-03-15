import bcrypt
from db import get_conn

def authenticate(username, password):
    conn = get_conn()
    c = conn.cursor()
    c.execute(
        "SELECT id, password_hash, role FROM users WHERE username=?",
        (username,)
    )
    row = c.fetchone()
    conn.close()

    if not row:
        return None

    user_id, pw_hash, role = row
    if bcrypt.checkpw(password.encode(), pw_hash):
        return {"id": user_id, "username": username, "role": role}
    return None
