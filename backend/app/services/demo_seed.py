from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.domain.codes import DEFAULT_RUBRIC_NAMES
from app.db.models import (
    Rubric,
    Scenario,
    Story,
    StoryMaterialLink,
    StoryProductionState,
    StoryWorkflowState,
    User,
)
from app.services.user_admin import set_user_functions


SYNTHETIC_DEMO_PASSWORD = "Synthetic-Demo-2026!"
SYNTHETIC_USERS = (
    ("astra", "Астра", "Начальник", ("chief",)),
    ("vega", "Вега", "Начальник-корреспондент", ("author", "chief")),
    ("iskra", "Искра", "Шеф-редактор", ("author", "chief_editor")),
    ("lira", "Лира", "Корреспондент", ("author",)),
    ("mayak", "Маяк", "Корректор", ("author", "proofreader")),
    ("orion", "Орион", "Монтажёр", ("video_editor",)),
    ("runa", "Руна", "Дизайнер", ("designer",)),
    ("sfera", "Сфера", "Оператор", ("operator",)),
)
RUBRIC_NAMES = DEFAULT_RUBRIC_NAMES
LEGACY_SYNTHETIC_RUBRIC_NAMES = frozenset({"Репортаж", "Интервью", "Культура"})


def build_demo_seed_payload() -> dict[str, object]:
    users = [
        {
            "id": f"synthetic-user-{index:02d}",
            "username": username,
            "display_name": display_name,
            "position": position,
            "functions": list(functions),
            "synthetic": True,
        }
        for index, (username, display_name, position, functions) in enumerate(
            SYNTHETIC_USERS, start=1
        )
    ]
    author_usernames = ("vega", "iskra", "lira", "mayak")
    stories = []
    for index in range(1, 36):
        lifecycle = "active" if index <= 30 else "archived"
        stories.append(
            {
                "id": f"synthetic-story-{index:02d}",
                "lifecycle": lifecycle,
                "title": f"Учебный сюжет {index:02d}",
                "rubric": RUBRIC_NAMES[(index - 1) % len(RUBRIC_NAMES)],
                "author": author_usernames[(index - 1) % len(author_usernames)],
                "priority": "high" if index % 7 == 0 else "standard",
                "materials": [
                    {
                        "title": "Учебный материал",
                        "location": f"https://media-{index:02d}.demo.invalid/story/{index:02d}",
                    }
                ],
            }
        )
    return {"data_classification": "synthetic", "users": users, "stories": stories}


def seed_demo_data(db: Session, *, password: str = SYNTHETIC_DEMO_PASSWORD) -> None:
    payload = build_demo_seed_payload()
    password_hash = hash_password(password)
    users_by_username = {
        user.username: user for user in db.execute(select(User)).scalars().all()
    }
    for record in payload["users"]:
        assert isinstance(record, dict)
        username = str(record["username"])
        user = users_by_username.get(username)
        if user is None:
            user = User(
                username=username,
                display_name=str(record["display_name"]),
                position=str(record["position"]),
                password_hash=password_hash,
                is_active=True,
                must_change_password=False,
                password_changed_at=datetime.now(UTC),
            )
            set_user_functions(user, tuple(record["functions"]))
            db.add(user)
            users_by_username[username] = user
    db.flush()

    rubrics_by_name = {
        rubric.name: rubric for rubric in db.execute(select(Rubric)).scalars().all()
    }
    for rubric_name in LEGACY_SYNTHETIC_RUBRIC_NAMES:
        rubric = rubrics_by_name.get(rubric_name)
        if rubric is not None:
            rubric.is_active = False
    for rubric_name in RUBRIC_NAMES:
        if rubric_name not in rubrics_by_name:
            rubric = Rubric(name=rubric_name, is_active=True)
            db.add(rubric)
            rubrics_by_name[rubric_name] = rubric
    db.flush()

    existing_titles = set(db.execute(select(Story.title)).scalars().all())
    now = datetime.now(UTC)
    for record in payload["stories"]:
        assert isinstance(record, dict)
        title = str(record["title"])
        if title in existing_titles:
            continue
        archived = record["lifecycle"] == "archived"
        author = users_by_username[str(record["author"])]
        rubric = rubrics_by_name[str(record["rubric"])]
        story = Story(
            title=title,
            rubric_id=rubric.id,
            author_user_id=author.id,
            priority=str(record["priority"]),
            aired_at=now if archived else None,
            aired_by_user_id=users_by_username["astra"].id if archived else None,
            archived_at=now if archived else None,
            archived_by_user_id=users_by_username["astra"].id if archived else None,
        )
        db.add(story)
        db.flush()
        scenario = Scenario(story_id=story.id, revision_no=0)
        db.add_all(
            [
                scenario,
                StoryWorkflowState(story_id=story.id),
                StoryProductionState(story_id=story.id),
            ]
        )
        material = record["materials"][0]
        db.add(
            StoryMaterialLink(
                story_id=story.id,
                title=str(material["title"]),
                location=str(material["location"]),
                added_by_user_id=author.id,
            )
        )
        existing_titles.add(title)
    db.commit()
