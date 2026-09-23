# Hostland production restore (CP6/incident runbook)

This procedure is **not automated** and must not be used on the current home
production or on an already populated target. It requires the owner's separate
CP6/incident authorization and a verified encrypted recovery point on the home
server. Stop the home backend before the final dump and keep it stopped after
cutover so stale DNS clients cannot write to the old database. If the home
gateway has no verified maintenance response, stop it too; stale DNS clients
may see a connection error. The owner accepted this for the current period
without users. Never move the age identity to the VDS.

1. Verify the current A records and TTL on both authoritative REG.RU name
   servers. The owner chose not to lower TTL: on 2026-09-23 the apex TTL was
   86400 seconds and `www` TTL was 21600 seconds. Plan for stale clients to
   use the home IP for at least 24 hours after both A records change.
   Verify the newest full release bundle and DB point at home, including
   ciphertext checksums and age decryptability. Select the DB point generated
   after stopping the home backend and confirming an attempted write through
   the old IP fails. Docker Compose `read_only` is a filesystem setting, not
   a database write block. Record its schema revision and aggregate
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
4. Start the restored backend, frontend, and gateway with the exact production
   Compose on loopback ports and maintenance mode; confirm all four services
   are healthy. Verify the application routes return 503. While ports remain
   bound to loopback, temporarily set `NGINX_MAINTENANCE=off` and recreate the
   gateway; for CP6 on the restored real production database, run
   `prod_smoke.py --host ncastnav.ru --connect-ip 127.0.0.1 --port 8447`
   without credentials and without `--write-test`. Check health, frontend,
   TLS, and gateway. Do not create a probe account or story on this database
   before cutover. Login, save/reload,
   DOCX, and CaptionPanels were exercised earlier on a separate synthetic
   restore, which was removed.
   For an incident restore or a new synthetic rehearsal, any `--write-test`
   requires an explicitly approved disposable account with the `author`
   function or `chief` access to an active author from
   `/api/v1/stories/create-options`. Treat every such test story as real
   target-state data when deciding whether rollback is safe. Set
   `NGINX_MAINTENANCE=on` again and recreate the gateway; verify application
   routes return 503 before any public binding or backup.
   Before opening the public site, manually run the installed production
   `backup_db_interval.sh` and `build_full_backup.sh` on VDS, then
   `home_pull_verify.sh --kind production` at home. Verify the matching new DB
   point and encrypted full bundle arrived and passed checks there. Timers are
   still disabled, so merely waiting for them is not a backup gate.
5. Only after all gates pass, open 80/443 with a verified TLS certificate and
   maintenance response and perform external `--resolve` checks. While
   maintenance still returns 503, change both A records in REG.RU under the
   separate CP6 authorization and verify both authoritative servers point to
   VDS. Then set `NGINX_MAINTENANCE=off`, recreate the gateway, and promptly
   verify health, frontend, login, and save externally with `--resolve` pinned
   to the VDS IP; check ordinary DNS resolution and browser access separately.
   A brief 503 interval
   during this sequence is accepted because there are currently no users.
   Keep the home backend
   stopped for at least 24 hours after both authoritative changes;
   the old IP must not accept writes during that interval. After that, retire
   the home application without restarting it against the stale database.
   If cutover fails before any VDS business-data changes, first stop the VDS
   backend (and gateway if it has no proven maintenance response), and verify
   a write through the new IP fails. Only then restore the old A records,
   verify the home database, restart the stopped home backend and gateway
   (and frontend if stopped), then verify login and a save there. Keep VDS
   unable to write for at least the previous maximum TTL after the reverse
   authoritative DNS change, then retire that application.
   Once VDS business data changes, do not roll DNS back to the stale home DB
   without reconciling those changes; use the newest verified VDS recovery
   point for an incident recovery. After the first VDS control save, create an
   extra database point and verify its delivery at home before ending the
   cutover window.

The VDS production service, backup timers, home pull timer, Certbot renewal,
and home mail monitor are not enabled by this runbook. CP7 must prove the first
new production backup actually arrived and restored at home. SMTP test mail was
received, but the mail timer must only be armed after the first verified new
full backup. Manually check the site, VDS logs, and delivered backup at cutover,
after 15 minutes, 1 hour, and 4 hours, then three times daily for two days.
