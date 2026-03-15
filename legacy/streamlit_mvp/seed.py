import bcrypt
from db import get_conn, init_db

users = [
    ("admin", "admin", "admin"),
    ("author", "author", "author"),
    ("editor", "editor", "editor"),
    ("proof", "proof", "proofreader"),
    ("designer", "designer", "designer"),
]

def seed():
    init_db()
    conn = get_conn()
    c = conn.cursor()

    for username, password, role in users:
        pw = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
        try:
            c.execute(
                "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                (username, pw, role),
            )
        except:
            pass

    conn.commit()
    conn.close()

if __name__ == "__main__":
    seed()
