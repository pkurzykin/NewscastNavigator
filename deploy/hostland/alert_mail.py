"""Send infrastructure alerts through the configured Gmail SMTP account."""

import argparse
from email.message import EmailMessage
import json
import os
from pathlib import Path
import re
import smtplib
import ssl
import stat


SUBJECTS = {
    ("site", "alert"): "Сайт недоступен",
    ("site", "reminder"): "Сайт всё ещё недоступен",
    ("site", "recovery"): "Сайт снова доступен",
    ("backup", "alert"): "Домашняя копия устарела",
    ("backup", "reminder"): "Домашняя копия всё ещё устарела",
    ("backup", "recovery"): "Доставка копий восстановлена",
    ("cert", "alert"): "Истекает срок HTTPS-сертификата",
    ("cert", "reminder"): "Срок HTTPS-сертификата всё ещё истекает",
    ("cert", "recovery"): "HTTPS-сертификат обновлён",
    ("test", "alert"): "Тестовое письмо мониторинга",
}


def _private_text(path: Path) -> str:
    if path.is_symlink():
        raise ValueError("Unsafe mail configuration")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError("Unsafe mail configuration")
    return path.read_text()


def load_config(path: Path) -> dict:
    config = json.loads(_private_text(path))
    validate_config(config)
    return config


def validate_config(config: dict) -> None:
    required = {"smtp_host", "smtp_port", "smtp_user", "from_addr", "to_addr", "password_file"}
    if not isinstance(config, dict) or not required <= config.keys():
        raise ValueError("Incomplete mail configuration")
    user = config["smtp_user"]
    if (config["smtp_host"] != "smtp.gmail.com" or config["smtp_port"] != 587 or
            not isinstance(user, str) or not re.fullmatch(r"[A-Za-z0-9._%+-]+@gmail\.com", user) or
            config["from_addr"] != user or
            not isinstance(config["to_addr"], str) or
            not re.fullmatch(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", config["to_addr"]) or
            not Path(config["password_file"]).is_absolute()):
        raise ValueError("Unsupported mail route")


def send_event(config: dict, kind: str, status: str, detail: str,
               *, smtp_factory=None) -> None:
    validate_config(config)
    subject = SUBJECTS.get((kind, status))
    if subject is None:
        raise ValueError("Unsupported alert")
    secret = "".join(_private_text(Path(config["password_file"])).split())
    if len(secret) < 16:
        raise ValueError("Mail credential is missing")
    safe_detail = " ".join(str(detail).split())[:300]
    message = EmailMessage()
    message["From"] = config["from_addr"]
    message["To"] = config["to_addr"]
    message["Subject"] = f"[NewscastNavigator] {subject}"
    message.set_content(
        f"Технический сигнал NewscastNavigator.\n"
        f"Проверка: {kind}. Состояние: {status}.\n"
        f"Детали: {safe_detail}.\n"
        "Рабочие данные и журналы в письмо не включены.\n"
    )
    factory = smtplib.SMTP if smtp_factory is None else smtp_factory
    with factory("smtp.gmail.com", 587, timeout=12) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        smtp.login(config["smtp_user"], secret)
        smtp.send_message(message)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--test", action="store_true", required=True)
    args = parser.parse_args()
    try:
        send_event(load_config(args.config), "test", "alert", "Проверка канала отправки")
    except Exception:
        print("ALERT_EMAIL_FAILED")
        raise SystemExit(1)
    print("ALERT_EMAIL_ACCEPTED_BY_SMTP=true")
