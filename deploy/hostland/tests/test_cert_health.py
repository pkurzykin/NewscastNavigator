import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "cert-health.sh"


class CertificateHealthTest(unittest.TestCase):
    def test_renewal_switches_one_validated_pair_atomically(self):
        root = SCRIPT.parent
        hook = (root / 'certbot-deploy-hook.sh').read_text()
        gateway = (root / 'production-gateway.conf.template').read_text()
        self.assertIn('mv -Tf "$link" "$runtime/tls/active"', hook)
        self.assertIn('/etc/nginx/certs/active/fullchain.pem', gateway)
        self.assertIn('/etc/nginx/certs/active/privkey.pem', gateway)
        self.assertNotIn('mv -f "$runtime/tls/.fullchain.pem.new"', hook)

    def make_pair(self, root, *, days=60, two_names=True):
        root.mkdir()
        names = "DNS:ncastnav.ru,DNS:www.ncastnav.ru" if two_names else "DNS:ncastnav.ru"
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(root / "privkey.pem"), "-out", str(root / "fullchain.pem"),
            "-days", str(days), "-subj", "/CN=ncastnav.ru",
            "-addext", "subjectAltName=" + names,
        ], capture_output=True, check=True)

    def run_check(self, root):
        return subprocess.run(["bash", str(SCRIPT), "--tls-dir", str(root)], capture_output=True)

    def test_valid_pair_and_both_names_are_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = Path(tmp) / "good"
            wrong = Path(tmp) / "wrong"
            self.make_pair(good)
            self.make_pair(wrong, two_names=False)
            self.assertEqual(self.run_check(good).returncode, 0)
            self.assertNotEqual(self.run_check(wrong).returncode, 0)
            (good / "privkey.pem").write_bytes((wrong / "privkey.pem").read_bytes())
            self.assertNotEqual(self.run_check(good).returncode, 0)

    def test_certificate_expiring_within_30_days_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            short = Path(tmp) / "short"
            self.make_pair(short, days=2)
            self.assertNotEqual(self.run_check(short).returncode, 0)


if __name__ == "__main__":
    unittest.main()
