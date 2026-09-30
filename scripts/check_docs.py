#!/usr/bin/env python3
"""Check maintained Markdown structure, links, navigation and frozen evidence.

Usage: python3 scripts/check_docs.py [--repo-root PATH] [--include-untracked]
By default the repository is found from this script, and only Git index entries
are considered. --include-untracked adds non-ignored local work in progress.
Exit 0 reports compact counts; exit 1 prints path:line diagnostics.
"""

import argparse
from collections import defaultdict, deque
from datetime import date
import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import subprocess
import sys
import unicodedata
from urllib.parse import unquote, urlsplit


REQUIRED = (
    "README.md", "AGENTS.md", "docs/README_RU.md", "docs/PROJECT_STATE_RU.md",
    "docs/DOCUMENTATION_POLICY_RU.md", "docs/product/SPEC_RU.md",
    "docs/product/EVAL_RUBRIC_RU.md", "docs/archive/EVIDENCE_MANIFEST.json",
)
TYPES = set("index state policy reference guide runbook decision plan report historical template".split())
STATUSES = set("active planned in_progress accepted completed historical template superseded".split())
CLOSED = {"completed", "historical", "superseded"}
META_KEYS = ("type", "status", "owner", "audience", "reviewed")
INLINE_START = re.compile(r"!?\[[^\]\n]+\]\(")
REFERENCE = re.compile(r"!?\[([^\]\n]+)\]\[([^\]\n]*)\]")
DEFINITION = re.compile(r"^\s{0,3}\[([^]]+)\]:\s*(<[^>]+>|\S+)")
HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$")
FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")


def git_paths(root, include_untracked):
    commands = [["git", "ls-files", "--cached", "-z"]]
    if include_untracked:
        commands.append(["git", "ls-files", "--others", "--exclude-standard", "-z"])
    names = set()
    for command in commands:
        result = subprocess.run(command, cwd=root, capture_output=True, check=True)
        names.update(part.decode("utf-8", "surrogateescape") for part in
                     result.stdout.split(b"\0") if part)
    return names


def diagnostic(errors, path, line, message):
    errors.append(f"{path}:{line}: {message}")


def parse_frontmatter(path, content, errors):
    lines = content.splitlines()
    if not lines or lines[0] != "---":
        diagnostic(errors, path, 1, "missing YAML frontmatter")
        return {}
    try:
        end = lines.index("---", 1)
    except ValueError:
        diagnostic(errors, path, 1, "unclosed YAML frontmatter")
        return {}
    metadata = {}
    for index, line in enumerate(lines[1:end], 2):
        match = re.fullmatch(r"([A-Za-z_]+):\s*(.*?)\s*", line)
        if not match:
            diagnostic(errors, path, index, "invalid simple YAML frontmatter line")
            continue
        key, value = match.groups()
        if key in metadata:
            diagnostic(errors, path, index, f"duplicate frontmatter key {key}")
        metadata[key] = value.strip('"\'')
    for key in META_KEYS:
        if not metadata.get(key):
            diagnostic(errors, path, 1, f"missing frontmatter key {key}")
    if metadata.get("type") and metadata["type"] not in TYPES:
        diagnostic(errors, path, 1, f"invalid type {metadata['type']}")
    if metadata.get("status") and metadata["status"] not in STATUSES:
        diagnostic(errors, path, 1, f"invalid status {metadata['status']}")
    if metadata.get("reviewed"):
        value = metadata["reviewed"]
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError
            date.fromisoformat(value)
        except ValueError:
            diagnostic(errors, path, 1, "reviewed must be a valid ISO date YYYY-MM-DD")
    return metadata


def visible_lines(content, *, headings=False):
    """Mask fenced examples; preserve code text for headings and link labels."""
    fence_char = None
    fence_len = 0
    for line in content.splitlines():
        marker = FENCE.match(line)
        if marker:
            run = marker.group(1)
            if fence_char is None:
                fence_char, fence_len = run[0], len(run)
            elif run[0] == fence_char and len(run) >= fence_len:
                fence_char = None
            yield ""
            continue
        if fence_char:
            yield ""
        else:
            def replace_code(match):
                if headings:
                    return match.group(2)
                prefix = line[:match.start()]
                open_label = prefix.rfind("[") > prefix.rfind("]")
                if open_label:
                    close = line.find("]", match.end())
                    if close >= 0 and line[close + 1:close + 2] in ("(", "["):
                        return match.group(0)
                return " " * len(match.group(0))

            yield re.sub(r"(`+)(.*?)\1", replace_code, line)


def slug(text):
    text = re.sub(r"\[[^]]+\]\([^)]*\)", lambda m: m.group(0).split("]")[0][1:], text)
    text = re.sub(r"<[^>]*>", "", text)
    text = text.replace("`", "").strip().lower()
    text = "".join(ch for ch in text if not unicodedata.category(ch).startswith("P")
                   or ch in "-_" )
    return re.sub(r"\s", "-", text)


def anchors(content):
    result = set()
    counts = defaultdict(int)
    for line in visible_lines(content, headings=True):
        heading = HEADING.match(line)
        if heading:
            base = slug(heading.group(2))
            count = counts[base]
            result.add(base if count == 0 else f"{base}-{count}")
            counts[base] += 1
        for anchor in re.finditer(r"<a\s+(?:id|name)=[\"']([^\"']+)[\"']", line, re.I):
            result.add(anchor.group(1))
    return result


def local_target(source, raw, paths, errors, line):
    raw = raw.strip("<>")
    parsed = urlsplit(raw)
    if parsed.scheme or parsed.netloc or raw.startswith("//") or raw.startswith("mailto:"):
        return None
    if raw.startswith("/"):
        diagnostic(errors, source, line, f"absolute repository link {raw}; use relative path")
        return None
    target_name = unquote(parsed.path)
    target = (source if not target_name else
              posixpath.normpath(posixpath.join(posixpath.dirname(source), target_name)))
    if target == ".." or target.startswith("../"):
        diagnostic(errors, source, line, f"link escapes repository: {raw}")
        return None
    if target not in paths:
        candidates = [posixpath.join(target, "README.md"),
                      posixpath.join(target, "README_RU.md")]
        target = next((candidate for candidate in candidates if candidate in paths), target)
    if target not in paths:
        diagnostic(errors, source, line, f"missing tracked link target: {raw}")
        return None
    return target, unquote(parsed.fragment)


def inline_links(line):
    """Find inline destinations, honoring balanced parentheses in filenames."""
    cursor = 0
    while match := INLINE_START.search(line, cursor):
        start = match.end()
        depth = 1
        end = start
        while end < len(line):
            char = line[end]
            if char == "\\":
                end += 2
                continue
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    break
            end += 1
        if depth != 0:
            cursor = match.end()
            continue
        inside = line[start:end].strip()
        if inside.startswith("<"):
            closing = inside.find(">")
            raw = inside[:closing + 1] if closing >= 0 else ""
        else:
            raw = inside.split(None, 1)[0] if inside else ""
        if raw:
            yield match.start(), end + 1, raw
        cursor = end + 1


def markdown_links(path, content):
    lines = list(visible_lines(content))
    definitions = {}
    for number, line in enumerate(lines, 1):
        match = DEFINITION.match(line)
        if match:
            definitions[" ".join(match.group(1).lower().split())] = (match.group(2), number)
    for number, line in enumerate(lines, 1):
        if DEFINITION.match(line):
            continue
        found = list(inline_links(line))
        for _, _, raw in found:
            yield number, raw
        without_inline = line
        for start, end, _ in reversed(found):
            without_inline = without_inline[:start] + without_inline[end:]
        for match in REFERENCE.finditer(without_inline):
            key = " ".join((match.group(2) or match.group(1)).lower().split())
            if key in definitions:
                yield number, definitions[key][0]
            else:
                yield number, None
        without_full_references = REFERENCE.sub("", without_inline)
        for match in re.finditer(r"!?\[([^\]\n]+)\](?!\()", without_full_references):
            key = " ".join(match.group(1).lower().split())
            if key in definitions:
                yield number, definitions[key][0]


def check_manifest(root, paths, errors):
    manifest_path = "docs/archive/EVIDENCE_MANIFEST.json"
    if manifest_path not in paths or not (root / manifest_path).is_file():
        return set()
    try:
        data = json.loads((root / manifest_path).read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        diagnostic(errors, manifest_path, 1, f"invalid evidence manifest: {exc}")
        return set()
    if not isinstance(data, dict) or data.get("schema_version") != 1 or not isinstance(data.get("files"), list):
        diagnostic(errors, manifest_path, 1, "expected {schema_version: 1, files: [...]} manifest")
        return set()
    frozen = set()
    for item in data["files"]:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str) or not isinstance(item.get("sha256"), str):
            diagnostic(errors, manifest_path, 1, "each file needs path and sha256")
            continue
        path, expected = item["path"], item["sha256"]
        if PurePosixPath(path).is_absolute() or ".." in PurePosixPath(path).parts or not path.startswith("docs/"):
            diagnostic(errors, manifest_path, 1, f"invalid frozen evidence path {path}")
            continue
        if path in frozen:
            diagnostic(errors, manifest_path, 1, f"duplicate frozen evidence path {path}")
        frozen.add(path)
        if path not in paths or not (root / path).is_file():
            diagnostic(errors, manifest_path, 1, f"frozen evidence missing from Git: {path}")
            continue
        if not re.fullmatch(r"[0-9a-f]{64}", expected):
            diagnostic(errors, manifest_path, 1, f"invalid sha256 for {path}")
            continue
        actual = hashlib.sha256((root / path).read_bytes()).hexdigest()
        if actual != expected:
            diagnostic(errors, path, 1, f"sha256 mismatch; expected {expected}, got {actual}")
    return frozen


def check(root, include_untracked=False):
    errors = []
    try:
        paths = git_paths(root, include_untracked)
    except (OSError, subprocess.CalledProcessError) as exc:
        return [f"{root}:1: cannot list Git files: {exc}"], 0, 0
    for path in REQUIRED:
        if path not in paths or not (root / path).is_file():
            diagnostic(errors, path, 1, "required entry missing from Git/worktree")
    frozen = check_manifest(root, paths, errors)
    managed = {path for path in paths if path.startswith("docs/") and path.endswith(".md")
               and (not path.startswith("docs/archive/") or path == "docs/archive/README_RU.md")
               and path not in frozen}
    content = {}
    metadata = {}
    for path in sorted(managed):
        try:
            content[path] = (root / path).read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            diagnostic(errors, path, 1, f"cannot read managed Markdown: {exc}")
            continue
        metadata[path] = parse_frontmatter(path, content[path], errors)
        if path == "docs/PROJECT_STATE_RU.md" and len(content[path].splitlines()) > 100:
            diagnostic(errors, path, 101, "PROJECT_STATE exceeds 100 lines")
        if path.startswith("docs/plans/") and Path(path).name != "README_RU.md":
            if metadata[path].get("status") in CLOSED:
                diagnostic(errors, path, 1, "closed plan belongs in docs/archive/")
            if not re.match(r"^\d{4}-\d{2}-\d{2}-", Path(path).name):
                diagnostic(errors, path, 1, "active plan filename must start YYYY-MM-DD-")
    link_sources = {path for path in paths if path.endswith(".md") and
                    (not path.startswith("docs/archive/") or path == "docs/archive/README_RU.md")
                    and path not in frozen}
    edges = defaultdict(set)
    anchor_cache = {}
    link_count = 0
    for path in sorted(link_sources):
        if path not in content:
            try:
                body = (root / path).read_text(encoding="utf-8")
            except (OSError, UnicodeError) as exc:
                diagnostic(errors, path, 1, f"cannot read Markdown: {exc}")
                continue
        else:
            body = content[path]
        for line, raw in markdown_links(path, body):
            if raw is None:
                diagnostic(errors, path, line, "undefined reference-style link")
                continue
            link_count += 1
            target = local_target(path, raw, paths, errors, line)
            if target is None:
                continue
            name, fragment = target
            if name in managed:
                edges[path].add(name)
            if fragment:
                if name not in anchor_cache:
                    try:
                        anchor_cache[name] = anchors((root / name).read_text(encoding="utf-8"))
                    except (OSError, UnicodeError):
                        anchor_cache[name] = set()
                if fragment not in anchor_cache[name]:
                    diagnostic(errors, path, line, f"missing heading anchor #{fragment} in {name}")
    reachable = set()
    queue = deque(["docs/README_RU.md"])
    while queue:
        path = queue.popleft()
        if path in reachable:
            continue
        reachable.add(path)
        queue.extend(edges[path] - reachable)
    for path in sorted(managed - reachable):
        diagnostic(errors, path, 1, "orphan managed document: not reachable from docs/README_RU.md")
    return errors, len(managed), link_count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--include-untracked", action="store_true")
    args = parser.parse_args()
    errors, documents, links = check(args.repo_root.resolve(), args.include_untracked)
    if errors:
        print("\n".join(sorted(set(errors))))
        print(f"docs check: {len(set(errors))} error(s), {documents} managed documents, {links} links")
        return 1
    print(f"docs check: OK, {documents} managed documents, {links} links")
    return 0


if __name__ == "__main__":
    sys.exit(main())
