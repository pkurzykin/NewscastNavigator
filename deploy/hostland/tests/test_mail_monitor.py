"""Behavioral tests for operational email alerts and verified backup evidence."""

import importlib
import json
import os
import stat
import ssl
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path


HOSTLAND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HOSTLAND))


def feature(name):
    path = HOSTLAND / f"{name}.py"
    if not path.is_file():
        raise AssertionError(f"Missing operational feature: {path.name}")
    return importlib.import_module(name)


class DeliveryMarkerTest(unittest.TestCase):
    def test_marker_records_only_a_verified_db_and_matching_full_bundle(self):
        marker = feature("write_delivery_marker")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            snapshots = root / "snapshots"
            snapshots.mkdir()
            full = "full-20260923T100000Z-production.tar.age"
            db = "db-20260923T100500Z-production.dump.age"
            for name, digest in ((full, "a" * 64), (db, "b" * 64)):
                (snapshots / name).write_bytes(b"encrypted")
                (snapshots / (name + ".sha256")).write_text(digest + "  " + name + "\n")
            rows = root / "rows"
            rows.write_text(
                f"{full}\t{'a'*64}\t9\t{'1'*40}\t1000\n"
                f"{db}\t{'b'*64}\t9\t{'1'*40}\t1300\n"
            )
            output = root / "monitor" / "latest-production.json"
            marker.write_marker(rows, snapshots, output, now=1400)
            evidence = json.loads(output.read_text())
            self.assertEqual(evidence, {
                "db_created_unix": 1300,
                "db_name": db,
                "full_name": full,
                "source_commit": "1" * 40,
                "verified_unix": 1400,
            })
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
            (snapshots / (full + ".sha256")).unlink()
            with self.assertRaises(ValueError):
                marker.write_marker(rows, snapshots, output, now=1500)
            self.assertEqual(json.loads(output.read_text())["verified_unix"], 1400)


class AlertTransitionTest(unittest.TestCase):
    def test_retention_failure_is_reported_once_per_day_and_recovers(self):
        monitor = feature("home_monitor")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            status = root / "retention-status.json"
            state = root / "state.json"
            sent = []
            sender = lambda *args: sent.append(args)
            status.write_text(json.dumps({"status": "failed", "last_attempt_unix": 1000,
                                          "last_success_unix": 900}))
            failed = monitor.check_retention(status, now=1200)
            self.assertFalse(failed[0])
            monitor.apply_observations(state, {"retention": failed}, 1200, sender)
            monitor.apply_observations(state, {"retention": failed}, 1300, sender)
            self.assertEqual([event[1] for event in sent], ["alert"])
            monitor.apply_observations(state, {"retention": failed}, 87601, sender)
            self.assertEqual([event[1] for event in sent], ["alert", "reminder"])
            status.write_text(json.dumps({"status": "ok", "last_attempt_unix": 87700,
                                          "last_success_unix": 87700}))
            monitor.apply_observations(
                state, {"retention": monitor.check_retention(status, now=87720)},
                87720, sender,
            )
            self.assertEqual(sent[-1][1], "recovery")

    def test_site_alert_requires_two_failures_then_deduplicates_and_recovers(self):
        monitor = feature("home_monitor")
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state.json"
            delivered = []
            send = lambda kind, status, detail: delivered.append((kind, status, detail))
            monitor.apply_observations(state, {"site": (False, "HTTP 503")}, 1000, send)
            self.assertEqual(delivered, [])
            monitor.apply_observations(state, {"site": (False, "HTTP 503")}, 1120, send)
            self.assertEqual(delivered, [("site", "alert", "HTTP 503")])
            monitor.apply_observations(state, {"site": (False, "HTTP 503")}, 1240, send)
            self.assertEqual(len(delivered), 1)
            monitor.apply_observations(state, {"site": (False, "HTTP 503")}, 4721, send)
            self.assertEqual(delivered[-1][1], "reminder")
            monitor.apply_observations(state, {"site": (True, "ok")}, 4840, send)
            self.assertEqual(delivered[-1], ("site", "recovery", "ok"))
            monitor.apply_observations(state, {"site": (True, "ok")}, 4960, send)
            self.assertEqual(len(delivered), 3)

    def test_failed_smtp_does_not_mark_an_alert_as_sent(self):
        monitor = feature("home_monitor")
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state.json"
            with self.assertRaises(OSError):
                monitor.apply_observations(state, {"backup": (False, "age=901s")}, 1000,
                                           lambda *_: (_ for _ in ()).throw(OSError("smtp unavailable")))
            delivered = []
            monitor.apply_observations(state, {"backup": (False, "age=1021s")}, 1120,
                                       lambda *args: delivered.append(args))
            self.assertEqual(delivered, [("backup", "alert", "age=1021s")])

    def test_successful_alert_is_not_duplicated_if_later_alert_send_fails(self):
        monitor = feature("home_monitor")
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state.json"
            monitor.apply_observations(state, {"site": (False, "HTTP 503")}, 1000, lambda *_: None)
            delivered = []

            def fail_backup(kind, status, detail):
                if kind == "backup":
                    raise OSError("smtp unavailable")
                delivered.append((kind, status, detail))

            with self.assertRaises(OSError):
                monitor.apply_observations(
                    state, {"site": (False, "HTTP 503"), "backup": (False, "age=901s")},
                    1120, fail_backup,
                )
            self.assertEqual(delivered, [("site", "alert", "HTTP 503")])
            monitor.apply_observations(state, {"site": (False, "HTTP 503")}, 1240,
                                       lambda *args: delivered.append(args))
            self.assertEqual(len(delivered), 1)

    def test_freshness_uses_source_creation_and_recent_verification(self):
        monitor = feature("home_monitor")
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "latest-production.json"
            marker.write_text(json.dumps({
                "db_created_unix": 1000, "verified_unix": 1080,
                "db_name": "db-20260923T100500Z-production.dump.age",
                "full_name": "full-20260923T100000Z-production.tar.age",
                "source_commit": "1" * 40,
            }))
            self.assertTrue(monitor.check_backup(marker, now=1200)[0])
            self.assertFalse(monitor.check_backup(marker, now=1901)[0])

    def test_https_probe_accepts_case_insensitive_content_type_and_checks_cert(self):
        monitor = feature("home_monitor")
        responses = [
            (200, {"content-type": "application/json"}, b'{"status":"ok"}',
             {"notAfter": "Dec 31 23:59:59 2026 GMT"}),
            (200, {"content-type": "text/html; charset=utf-8"}, b"<html></html>",
             {"notAfter": "Dec 31 23:59:59 2026 GMT"}),
        ]
        with patch.object(monitor, "_https_request", side_effect=responses), \
             patch.object(monitor, "_check_certificate", return_value=(True, "cert ok")):
            site, cert = monitor.check_site("185.221.215.76", now=1790000000)
        self.assertTrue(site[0])
        self.assertTrue(cert[0])

    def test_bad_http_response_does_not_cancel_certificate_observation(self):
        monitor = feature("home_monitor")
        for response in (b"[]", b"broken"):
            with self.subTest(response=response), \
                 patch.object(monitor, "_check_certificate", return_value=(False, "expires soon")), \
                 patch.object(monitor, "_https_request", return_value=(200, {}, response, {})):
                site, cert = monitor.check_site("185.221.215.76", now=1790000000)
                self.assertFalse(site[0])
                self.assertEqual(cert, (False, "expires soon"))

    def test_http_protocol_error_is_reported_as_site_failure(self):
        monitor = feature("home_monitor")
        import http.client
        with patch.object(monitor, "_check_certificate", return_value=(True, "cert ok")), \
             patch.object(monitor, "_https_request", side_effect=http.client.BadStatusLine("bad")):
            site, cert = monitor.check_site("185.221.215.76")
        self.assertFalse(site[0])
        self.assertTrue(cert[0])

    def test_monitor_requires_private_cutover_arming_file(self):
        monitor = feature("home_monitor")
        with tempfile.TemporaryDirectory() as tmp:
            armed = Path(tmp) / "cutover-active"
            self.assertFalse(monitor.is_armed(armed))
            armed.write_text("monitor-enabled\n")
            os.chmod(armed, 0o600)
            self.assertTrue(monitor.is_armed(armed))
            os.chmod(armed, 0o644)
            self.assertFalse(monitor.is_armed(armed))

    def test_unarmed_monitor_does_not_load_mail_credentials_or_probe_site(self):
        monitor = feature("home_monitor")
        with patch.object(monitor, "is_armed", return_value=False), \
             patch.object(monitor, "load_config") as load, \
             patch.object(monitor, "check_site") as probe, \
             patch.object(sys, "argv", ["home_monitor.py", "--config", "/unused"]):
            self.assertEqual(monitor.main(), 1)
        load.assert_not_called()
        probe.assert_not_called()

    def test_transient_tls_protocol_failure_is_not_reported_as_expiring_cert(self):
        monitor = feature("home_monitor")
        with patch.object(monitor.socket, "create_connection", side_effect=ssl.SSLEOFError("EOF")):
            self.assertIsNone(monitor._check_certificate("185.221.215.76", now=1790000000))

    def test_certificate_validation_failure_is_reported(self):
        monitor = feature("home_monitor")
        with patch.object(monitor.socket, "create_connection",
                          side_effect=ssl.SSLCertVerificationError("verify failed")):
            cert = monitor._check_certificate("185.221.215.76", now=1790000000)
        self.assertFalse(cert[0])


class SmtpTransportTest(unittest.TestCase):
    def test_sender_requires_tls_and_targets_only_owner(self):
        mail = feature("alert_mail")
        calls = []

        class FakeSMTP:
            def __init__(self, host, port, timeout):
                calls.append(("connect", host, port, timeout))

            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def ehlo(self):
                calls.append(("ehlo",))

            def starttls(self, context):
                calls.append(("tls", context.verify_mode))

            def login(self, user, password):
                calls.append(("login", user, password))

            def send_message(self, message):
                calls.append(("send", message["From"], message["To"], message["Subject"]))

        with tempfile.TemporaryDirectory() as tmp:
            secret = Path(tmp) / "secret"
            secret.write_text("abcdefghijklmnop\n")
            os.chmod(secret, 0o600)
            config = {
                "smtp_host": "smtp.gmail.com", "smtp_port": 587,
                "smtp_user": "synthetic-notifier@gmail.com",
                "from_addr": "synthetic-notifier@gmail.com",
                "to_addr": "owner@example.invalid",
                "password_file": str(secret),
            }
            mail.send_event(config, "site", "alert", "HTTP 503", smtp_factory=FakeSMTP)
        self.assertEqual(calls[0][:3], ("connect", "smtp.gmail.com", 587))
        self.assertLess(next(i for i, x in enumerate(calls) if x[0] == "tls"),
                        next(i for i, x in enumerate(calls) if x[0] == "login"))
        self.assertEqual(calls[-1][1:3], ("synthetic-notifier@gmail.com", "owner@example.invalid"))


if __name__ == "__main__":
    unittest.main()
