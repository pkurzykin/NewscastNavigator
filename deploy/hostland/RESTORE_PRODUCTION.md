# Hostland production restore (CP6/incident runbook)

This procedure is **not automated** and must not be used on the current home
production or on an already populated target. It requires the owner's separate
CP6/incident authorization and a verified encrypted recovery point on the home
server. Keep the home service read-only before the final dump and throughout DNS
propagation. Never move the age identity to the VDS.

1. Verify the newest full release bundle and DB point at home, including
   ciphertext checksums and age decryptability. Select the DB point generated
   after writes were stopped. Record its schema revision and aggregate
   `db_fingerprint.py` result. Ensure the release image manifest and source
   archive are the exact approved commit.
2. Decrypt **at home** into a private temporary directory. For a fresh host,
   transfer the full bundle through pinned SSH and extract `runtime/` into
   `/opt/newscast-production`, preserving the relative `tls/active` symlink
   and `tls/versions/initial` pair. Load `images.tar`, create an empty
   `acme-webroot` with mode 0755, keep the runtime root-only, then run
   `verify_release.sh`. The encrypted full bundle includes its service units
   in `runtime/systemd/`; install/enable them only at the authorized step.
   The full bundle's database dump is a fallback recovery point; for cutover
   choose the later final DB point taken after writes stopped.

   Transfer the chosen `database.dump`, its strict `database.dump.sha256`, and
   `source-fingerprint.json` over pinned SSH into a root-owned
   `/opt/newscast-restore-staging-<id>` directory on Hostland. Do not include
   plaintext in chat, Git, logs, or a Mac filesystem. The age identity remains
   at home. Erase home and VDS plaintext staging after verification.
3. Confirm `/opt/newscast-production` matches the exact image
   manifest, its gateway is still bound to loopback/maintenance, the production
   service is stopped, and the target PostgreSQL volume is **empty**. Run
   `restore_production.sh --staging-dir /opt/newscast-restore-staging-<id>` as
   root. It checks checksum, image IDs/source, empty DB, all 21 table
   fingerprints before migration, and Alembic `20260914_0005` after migration.
   It deliberately does not start the application. A failed run requires a new
   empty target volume; never retry over a partially restored DB.
4. Confirm `prod_smoke.py` on the loopback endpoint, first anonymously, then
   with a dedicated temporary test account. A write-test account must have the
   `author` function or `chief` access to an active author listed by
   `/api/v1/stories/create-options`; a login alone does not prove that a story
   can be created. Use `--write-test` only for the approved synthetic test
   account and only during the cutover window. Check
   login, save/reload, DOCX, CaptionPanels, gateway, and database health.
5. Only after all gates pass, open 80/443 with a verified TLS certificate and
   maintenance response, perform external `--resolve` checks, then change both
   A records in REG.RU under the separate CP6 authorization. Keep the home
   gateway read-only for stale DNS clients. If writes happen on VDS, do not
   roll DNS back to the stale home DB without reconciling those writes.

The VDS production service, backup timers, home pull timer, and Certbot renewal
are not enabled by this runbook. CP7 must prove the first new production backup
actually arrived and restored at home. The current choice for alerts is
`journald` only; a human review schedule is needed before opening the site.
