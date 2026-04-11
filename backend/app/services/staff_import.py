from __future__ import annotations

from dataclasses import dataclass
import secrets
import string
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import User
from app.services.user_admin import set_temporary_password


XLSX_NS = {"main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
ROLE_BY_JOB_TITLE = {
    "зам.генерального директора": "editor",
    "шеф-редактор": "editor",
    "корректор": "proofreader",
    "дизайнер": "designer",
    "монтажер": "montager",
    "корреспондент": "author",
    "оператор": "operator",
}
TRANSLIT_MAP = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh",
    "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts",
    "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu",
    "я": "ya",
}
TEMP_PASSWORD_ALPHABET = string.ascii_letters + string.digits


@dataclass(slots=True)
class StaffRow:
    job_title: str
    full_name: str
    role: str
    username: str


@dataclass(slots=True)
class StaffImportResultItem:
    username: str
    full_name: str
    job_title: str
    role: str
    created: bool
    temporary_password: str | None


def _xlsx_cell_value(cell: ET.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    value_node = cell.find("main:v", XLSX_NS)
    if cell_type == "s":
        if value_node is None or value_node.text is None:
            return ""
        return shared_strings[int(value_node.text)]
    inline_node = cell.find("main:is", XLSX_NS)
    if inline_node is not None:
        return "".join(item.text or "" for item in inline_node.iterfind(".//main:t", XLSX_NS))
    return value_node.text if value_node is not None and value_node.text is not None else ""


def _load_shared_strings(xlsx_path: Path) -> tuple[list[str], ET.Element]:
    with zipfile.ZipFile(xlsx_path) as archive:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("main:si", XLSX_NS):
                shared_strings.append(
                    "".join(node.text or "" for node in item.iterfind(".//main:t", XLSX_NS))
                )
        workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
    return shared_strings, workbook_root


def _first_sheet_path(xlsx_path: Path, workbook_root: ET.Element) -> str:
    with zipfile.ZipFile(xlsx_path) as archive:
        rels_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    rel_map = {
        item.attrib["Id"]: item.attrib["Target"]
        for item in rels_root.findall(
            "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"
        )
    }
    first_sheet = next(iter(workbook_root.find("main:sheets", XLSX_NS)))
    rel_id = first_sheet.attrib[
        "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    ]
    return "xl/" + rel_map[rel_id]


def _iter_staff_sheet_rows(xlsx_path: Path) -> list[tuple[str, str]]:
    shared_strings, workbook_root = _load_shared_strings(xlsx_path)
    sheet_path = _first_sheet_path(xlsx_path, workbook_root)
    with zipfile.ZipFile(xlsx_path) as archive:
        sheet_root = ET.fromstring(archive.read(sheet_path))
    result: list[tuple[str, str]] = []
    for row in sheet_root.findall(".//main:sheetData/main:row", XLSX_NS):
        cells = {cell.attrib.get("r", ""): _xlsx_cell_value(cell, shared_strings).strip() for cell in row.findall("main:c", XLSX_NS)}
        row_no = row.attrib.get("r", "")
        job_title = cells.get(f"A{row_no}", "").strip()
        full_name = cells.get(f"B{row_no}", "").strip()
        if not job_title or not full_name:
            continue
        result.append((job_title, full_name))
    return result


def infer_role_from_job_title(job_title: str) -> str:
    normalized = " ".join((job_title or "").strip().lower().split())
    return ROLE_BY_JOB_TITLE.get(normalized, "operator")


def _transliterate(value: str) -> str:
    chunks: list[str] = []
    for char in value.strip().lower():
        if char in TRANSLIT_MAP:
            chunks.append(TRANSLIT_MAP[char])
        elif char.isascii() and char.isalnum():
            chunks.append(char)
        elif char in {" ", "-", "."}:
            chunks.append("")
    return "".join(chunks)


def build_username(full_name: str, taken_usernames: set[str]) -> str:
    parts = [part for part in full_name.strip().split() if part]
    if not parts:
        raise ValueError("Пустое ФИО нельзя преобразовать в логин")
    surname = _transliterate(parts[0]) or "user"
    initials = "".join(_transliterate(part[:1]) for part in parts[1:3])
    base = f"{surname}.{initials}" if initials else surname
    candidate = base[:120] or "user"
    suffix = 2
    while candidate in taken_usernames:
        suffix_token = str(suffix)
        candidate = f"{base[: max(1, 120 - len(suffix_token))]}{suffix_token}"
        suffix += 1
    taken_usernames.add(candidate)
    return candidate


def generate_temporary_password(length: int = 16) -> str:
    return "".join(secrets.choice(TEMP_PASSWORD_ALPHABET) for _ in range(length))


def load_staff_rows_from_xlsx(xlsx_path: str | Path) -> list[StaffRow]:
    source_path = Path(xlsx_path).expanduser().resolve()
    raw_rows = _iter_staff_sheet_rows(source_path)
    taken_usernames: set[str] = set()
    result: list[StaffRow] = []
    for job_title, full_name in raw_rows:
        username = build_username(full_name, taken_usernames)
        result.append(
            StaffRow(
                job_title=job_title,
                full_name=full_name,
                role=infer_role_from_job_title(job_title),
                username=username,
            )
        )
    return result


def import_staff_users(
    db: Session,
    *,
    rows: list[StaffRow],
    reset_existing_passwords: bool = False,
) -> list[StaffImportResultItem]:
    existing_users = {
        row.username: row
        for row in db.execute(select(User)).scalars().all()
    }
    result: list[StaffImportResultItem] = []

    for row in rows:
        user = existing_users.get(row.username)
        created = False
        temporary_password: str | None = None
        if user is None:
            user = User(
                username=row.username,
                full_name=row.full_name,
                job_title=row.job_title,
                role=row.role,
                is_active=True,
                must_change_password=True,
                password_hash="",
            )
            db.add(user)
            db.flush()
            created = True
            existing_users[user.username] = user
        else:
            user.full_name = row.full_name
            user.job_title = row.job_title
            user.role = row.role
            user.is_active = True
            db.add(user)
            db.flush()

        if created or reset_existing_passwords:
            temporary_password = generate_temporary_password()
            set_temporary_password(db, user, temporary_password)
        else:
            db.refresh(user)

        result.append(
            StaffImportResultItem(
                username=user.username,
                full_name=user.full_name or row.full_name,
                job_title=user.job_title or row.job_title,
                role=user.role,
                created=created,
                temporary_password=temporary_password,
            )
        )

    return result
