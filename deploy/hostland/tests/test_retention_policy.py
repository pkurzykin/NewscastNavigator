"""Pure retention decisions for encrypted production backup points."""

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from retention_policy import PolicyError, plan_retention


NOW = int(datetime(2026, 12, 7, 12, tzinfo=timezone.utc).timestamp())
DAY = 86400
COMMIT_A = "a" * 40
COMMIT_B = "b" * 40


def point(kind, age_days, commit=COMMIT_A, minute=0):
    created = NOW - age_days * DAY + minute * 60
    stamp = datetime.fromtimestamp(created, timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    name = (f"db-{stamp}-production.dump.age" if kind == "db"
            else f"full-{stamp}-production.tar.age")
    return {"name": name, "kind": "production", "source_commit": commit,
            "sha256": "1" * 64, "bytes": 100, "created_unix": created}


class RetentionPolicyTest(unittest.TestCase):
    def test_keeps_thirty_days_and_two_newest_db_points(self):
        full = point("full", 80)
        recent = [point("db", 1), point("db", 29), point("db", 30)]
        old = point("db", 31)
        plan = plan_retention([full, *recent, old], NOW)
        self.assertEqual(plan["delete_db"], [old["name"]])
        self.assertTrue(set(item["name"] for item in recent).issubset(plan["keep"]))

    def test_preserves_all_full_archives_until_eight_weeks_exist(self):
        full = [point("full", 7 * week + 1) for week in range(1, 8)]
        db = point("db", 1)
        plan = plan_retention([*full, db], NOW)
        self.assertEqual(plan["delete_full"], [])

    def test_prunes_only_extra_full_older_than_eight_weeks(self):
        full = [point("full", 7 * week + 1) for week in range(1, 10)]
        db = point("db", 1)
        plan = plan_retention([*full, db], NOW)
        self.assertEqual(plan["delete_full"], [full[-1]["name"]])
        self.assertEqual(len(plan["kept_weeks"]), 8)

    def test_keeps_full_for_retained_release_even_when_older(self):
        weekly = [point("full", 7 * week + 1) for week in range(1, 10)]
        old_release = point("full", 100, COMMIT_B)
        db = point("db", 1, COMMIT_B)
        plan = plan_retention([*weekly, old_release, db], NOW)
        self.assertIn(old_release["name"], plan["keep"])

    def test_missing_full_for_any_db_blocks_everything(self):
        with self.assertRaisesRegex(PolicyError, "matching full"):
            plan_retention([point("full", 1), point("db", 31, COMMIT_B)], NOW)

    def test_future_timestamp_blocks_everything(self):
        with self.assertRaisesRegex(PolicyError, "future"):
            plan_retention([point("full", 1), point("db", -1)], NOW)

    def test_filename_time_must_precede_metadata_by_bounded_build_time(self):
        full = point("full", 40)
        db = point("db", 31)
        with self.assertRaisesRegex(PolicyError, "differs"):
            plan_retention([full, dict(db, created_unix=db["created_unix"] - DAY)], NOW)
        self.assertEqual(plan_retention([dict(full, created_unix=full["created_unix"] + 24),
                                         dict(db, created_unix=db["created_unix"] + 2),
                                         point("db", 1), point("db", 2)], NOW)["delete_db"], [db["name"]])

    def test_rejects_synthetic_and_duplicate_metadata(self):
        full = point("full", 1)
        db = point("db", 1)
        with self.assertRaises(PolicyError):
            plan_retention([full, dict(db, kind="synthetic")], NOW)
        with self.assertRaises(PolicyError):
            plan_retention([full, db, db], NOW)

    def test_caps_daily_batch(self):
        full = point("full", 90)
        db = [point("db", 31 + day, minute=day) for day in range(700)]
        latest = point("db", 1)
        plan = plan_retention([full, *db, latest], NOW)
        self.assertEqual(len(plan["delete_db"]), 576)


if __name__ == "__main__":
    unittest.main()
