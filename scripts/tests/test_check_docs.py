"""Structural documentation checks against synthetic Git repositories."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


CHECKER = Path(__file__).resolve().parents[1] / "check_docs.py"
META = "---\ntype: {type}\nstatus: {status}\nowner: docs\naudience: agents\nreviewed: 2026-09-30\n---\n\n# {title}\n"
GIT_EVIDENCE = (
    "ARCHITECTURE_INVENTORY_RU.md", "EVAL_COMMANDS.json", "LEGACY_DENYLIST.txt",
    "OPERATIONS_INVENTORY_RU.md", "PROGRESS.md", "RISK_REGISTER_RU.md",
)
WORKTREE_EVIDENCE = ("DEMO_EVIDENCE.json", "EVAL_RESULT.json", "UX_EVAL_RU.md")


class DocumentationCheckerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.write("README.md", "# Project\n[Docs](docs/README_RU.md)\n")
        self.write("AGENTS.md", "# Agents\n[Docs](docs/README_RU.md)\n")
        self.doc("docs/README_RU.md", "index", "Catalog", "\n".join(
            f"[{name}]({name})" for name in [
                "PROJECT_STATE_RU.md", "DOCUMENTATION_POLICY_RU.md",
                "product/SPEC_RU.md", "product/EVAL_RUBRIC_RU.md",
                "archive/README_RU.md",
            ]) + "\n")
        self.doc("docs/PROJECT_STATE_RU.md", "state", "State")
        self.doc("docs/DOCUMENTATION_POLICY_RU.md", "policy", "Policy")
        self.doc("docs/product/SPEC_RU.md", "reference", "Specification")
        self.doc("docs/product/EVAL_RUBRIC_RU.md", "reference", "Quality")
        self.doc("docs/archive/README_RU.md", "index", "Archive")
        self.write("docs/archive/EVIDENCE_MANIFEST.json", '{"schema_version":1,"files":[]}\n')
        self.stage()

    def write(self, name, content):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def doc(self, name, kind, title, body="", status="active"):
        self.write(name, META.format(type=kind, status=status, title=title) + body)

    def stage(self):
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True)

    def commit(self):
        self.stage()
        subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                        "commit", "-qm", "synthetic evidence"], cwd=self.root, check=True)
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root,
                                       text=True).strip()

    def schema_two(self, source_commit, files):
        self.write("docs/archive/EVIDENCE_MANIFEST.json", json.dumps({
            "schema_version": 2, "source_commit": source_commit, "files": files,
        }))

    def seed_schema_two_evidence(self):
        prefix = "docs/product-reset/"
        contents = {name: (b"[historical broken link](missing.md)\n" if name == "UX_EVAL_RU.md"
                           else b"historical bytes\n") for name in GIT_EVIDENCE + WORKTREE_EVIDENCE}
        for name, body in contents.items():
            path = self.root / prefix / name
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(body)
        source_commit = self.commit()
        for name in GIT_EVIDENCE:
            (self.root / prefix / name).unlink()
        entries = [{"path": prefix + name, "sha256": hashlib.sha256(contents[name]).hexdigest(),
                    "storage": "git" if name in GIT_EVIDENCE else "worktree"}
                   for name in GIT_EVIDENCE + WORKTREE_EVIDENCE]
        self.schema_two(source_commit, entries)
        self.stage()
        return source_commit, entries

    def check(self, *args):
        return subprocess.run(
            [sys.executable, str(CHECKER), "--repo-root", str(self.root), *args],
            text=True, capture_output=True, check=False,
        )

    def assert_bad(self, fragment, *args):
        result = self.check(*args)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(fragment, result.stdout + result.stderr)

    def test_valid_inline_reference_unicode_duplicate_and_fenced_example(self):
        self.doc("docs/guides/guide.md", "guide", "Guide", """
## Привет, мир!
## Привет, мир!
[first](#привет-мир) [second][twice] [twice] ![image](../../image.png)
[root](../../README.md)

[twice]: #привет-мир-1

```md
[fake](missing.md)
```
""")
        self.write("image.png", "not a real image")
        self.write("docs/README_RU.md", (self.root / "docs/README_RU.md").read_text() +
                   "[guide](guides/guide.md)\n")
        self.stage()
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_ignored_file_does_not_satisfy_tracked_link(self):
        self.write(".gitignore", "local.md\n")
        self.write("README.md", "# Project\n[local](local.md)\n")
        self.write("local.md", "# local only\n")
        self.stage()
        self.assert_bad("local.md")

    def test_wrong_anchor(self):
        self.write("README.md", "# Project\n[wrong](docs/PROJECT_STATE_RU.md#missing)\n")
        self.stage()
        self.assert_bad("#missing")

    def test_inline_code_in_heading_keeps_anchor_text(self):
        self.doc("docs/guides/code.md", "guide", "Guide", "\n## Настройка `foo`\n")
        self.write("docs/README_RU.md", (self.root / "docs/README_RU.md").read_text() +
                   "[code](guides/code.md#настройка-foo)\n")
        self.stage()
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_code_styled_link_label_still_checks_target(self):
        self.write("README.md", "# Project\n[`код`](missing.md)\n")
        self.stage()
        self.assert_bad("missing tracked link target: missing.md")

    def test_literal_inline_code_link_is_ignored_but_code_label_is_link(self):
        self.write("README.md", "# Project\n`[fake](missing.md)`\n"
                   "[`код`](docs/README_RU.md)\n")
        self.stage()
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_parentheses_in_link_target(self):
        self.doc("docs/guides/guide_(local).md", "guide", "Guide")
        self.write("docs/README_RU.md", (self.root / "docs/README_RU.md").read_text() +
                   "[local guide](guides/guide_(local).md)\n")
        self.stage()
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_orphan_document(self):
        self.doc("docs/guides/orphan.md", "guide", "Orphan")
        self.assertEqual(self.check().returncode, 0)
        self.assert_bad("orphan", "--include-untracked")

    def test_link_cannot_escape_repository(self):
        self.write("README.md", "# Project\n[escape](../outside.md)\n")
        self.stage()
        self.assert_bad("escapes repository")

    def test_missing_metadata(self):
        self.write("docs/product/SPEC_RU.md", "# Specification\n")
        self.stage()
        self.assert_bad("frontmatter")

    def test_closed_plan_and_non_dated_plan(self):
        self.doc("docs/plans/2026-09-30-done.md", "plan", "Done", status="completed")
        self.doc("docs/plans/undated.md", "plan", "Future", status="planned")
        self.write("docs/README_RU.md", (self.root / "docs/README_RU.md").read_text() +
                   "[done](plans/2026-09-30-done.md) [future](plans/undated.md)\n")
        self.stage()
        self.assert_bad("closed plan")
        self.assert_bad("YYYY-MM-DD")

    def test_tampered_frozen_evidence(self):
        path = "docs/archive/evidence.md"
        content = b"[historical broken link](missing.md)\n"
        (self.root / path).write_bytes(content)
        self.write("docs/archive/EVIDENCE_MANIFEST.json", json.dumps({
            "schema_version": 1,
            "files": [{"path": path, "sha256": hashlib.sha256(content).hexdigest()}],
        }))
        self.stage()
        self.assertEqual(self.check().returncode, 0)
        (self.root / path).write_bytes(b"altered\n")
        self.assert_bad("sha256")

    def test_schema_two_git_evidence_uses_committed_blob_without_checkout_copy(self):
        self.seed_schema_two_evidence()
        for name in GIT_EVIDENCE:
            self.assertFalse((self.root / "docs/product-reset" / name).exists())
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_schema_two_rejects_bad_commit_missing_blob_hash_path_and_storage(self):
        source_commit, entries = self.seed_schema_two_evidence()
        valid = next(item for item in entries if item["path"].endswith("/PROGRESS.md"))
        cases = [
            ("0" * 40, valid, "source_commit"),
            (source_commit, {**valid, "path": "docs/product-reset/MISSING.md"}, "Git blob"),
            (source_commit, {**valid, "sha256": "0" * 64}, "sha256 mismatch"),
            (source_commit, {**valid, "path": "docs/product-reset/../outside.md"}, "invalid frozen evidence path"),
            (source_commit, {**valid, "storage": "unknown"}, "invalid storage"),
            ("short", valid, "source_commit"),
        ]
        for commit, item, message in cases:
            with self.subTest(message=message, item=item):
                self.schema_two(commit, [item if entry is valid else entry for entry in entries])
                self.stage()
                self.assert_bad(message)
        self.schema_two("0" * 40, [])
        self.stage()
        self.assert_bad("source_commit")

    def test_schema_two_worktree_evidence_remains_frozen(self):
        self.seed_schema_two_evidence()
        path = "docs/product-reset/UX_EVAL_RU.md"
        self.assertEqual(self.check().returncode, 0)
        (self.root / path).write_bytes(b"changed\n")
        self.assert_bad("sha256 mismatch")

    def test_schema_two_requires_exact_paths_and_storage(self):
        source_commit, entries = self.seed_schema_two_evidence()
        self.assertEqual(self.check().returncode, 0)
        for omitted in ("DEMO_EVIDENCE.json", "EVAL_RESULT.json"):
            with self.subTest(omitted=omitted):
                self.schema_two(source_commit, [entry for entry in entries
                                                if not entry["path"].endswith("/" + omitted)])
                self.stage()
                self.assert_bad("evidence manifest paths/storage differ")
        self.schema_two(source_commit, entries + [{"path": "docs/product-reset/EXTRA.json",
                                                   "sha256": "0" * 64, "storage": "git"}])
        self.stage()
        self.assert_bad("evidence manifest paths/storage differ")
        changed = [{**entry, "storage": "git"} if entry["path"].endswith("/DEMO_EVIDENCE.json")
                   else entry for entry in entries]
        self.schema_two(source_commit, changed)
        self.stage()
        self.assert_bad("evidence manifest paths/storage differ")

    def test_archive_documents_need_metadata_closed_status_and_reachability(self):
        path = "docs/archive/forgotten.md"
        self.write(path, "# No passport\n")
        self.stage()
        self.assert_bad("frontmatter")
        self.doc(path, "historical", "Forgotten", status="active")
        self.stage()
        self.assert_bad("archived document must have closed status")
        self.doc(path, "historical", "Forgotten", status="historical")
        self.stage()
        self.assert_bad("orphan managed document")
        self.write("docs/archive/README_RU.md", (self.root / "docs/archive/README_RU.md").read_text() +
                   "[forgotten](forgotten.md)\n")
        self.stage()
        self.assertEqual(self.check().returncode, 0)

    def test_design_manifest_checks_exact_tracked_siblings_and_bytes(self):
        base = "docs/archive/example/approved-baseline"
        readme = f"{base}/README_RU.md"
        artifact = f"{base}/image.png"
        self.doc(readme, "historical", "Baseline", status="historical")
        (self.root / artifact).write_bytes(b"png bytes")
        self.write("docs/archive/README_RU.md", (self.root / "docs/archive/README_RU.md").read_text() +
                   f"[baseline](example/approved-baseline/README_RU.md)\n")
        source_commit = self.commit()
        files = {name: {"bytes": len((self.root / base / name).read_bytes()),
                        "sha256": hashlib.sha256((self.root / base / name).read_bytes()).hexdigest()}
                 for name in ("README_RU.md", "image.png")}
        manifest = f"{base}/manifest.json"
        data = {"status": "user-approved-visual-baseline", "source_commit": source_commit, "files": files}
        self.write(manifest, json.dumps(data))
        self.stage()
        self.assertEqual(self.check().returncode, 0)
        (self.root / artifact).write_bytes(b"changed")
        self.assert_bad("sha256 mismatch")
        (self.root / artifact).write_bytes(b"png bytes")
        (self.root / artifact).unlink()
        self.stage()
        self.assert_bad("tracked siblings")
        (self.root / artifact).write_bytes(b"png bytes")
        self.write(f"{base}/new.jsx", "new artifact")
        self.stage()
        self.assert_bad("tracked siblings")
        (self.root / f"{base}/new.jsx").unlink()
        self.stage()
        data["files"]["._image.png"] = files["image.png"]
        self.write(manifest, json.dumps(data))
        self.stage()
        self.assert_bad("invalid baseline filename")
        data["files"] = {"../escape": files["image.png"]}
        self.write(manifest, json.dumps(data))
        self.stage()
        self.assert_bad("invalid baseline filename")


if __name__ == "__main__":
    unittest.main()
