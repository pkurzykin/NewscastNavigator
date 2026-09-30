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


if __name__ == "__main__":
    unittest.main()
