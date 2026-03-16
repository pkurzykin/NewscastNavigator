# Changelog

## Unreleased

- Repository initialized as web-first.
- Legacy Streamlit MVP was isolated during migration and then removed from `main` after successful cutover.
- GitHub repository connected and `main` published.
- Project workflow parity moved into the web stack: statuses, assignments, history, archive metadata and richer filters.
- `EDITOR`/`WORKSPACE` now use shared project metadata helpers, and `proofreader` edit rules are aligned with the legacy workflow.
- Backend API smoke tests added for roles, archive/restore, editor/workspace metadata, history and exports.
- Added production deploy foundation for the web stack: prod compose, prod Dockerfiles, nginx, backup scripts and server-audit checklist.
- Added a read-only server audit snapshot script for safe inventory of the existing home server state.
- Added legacy-to-web migration tooling: SQLite importer, legacy bcrypt password compatibility and tests for safe data transfer into the clean web stack.
- Production deploy now supports configurable nginx bind host, and the server runbooks point to the clean `/opt/newscast-web` deploy path.
- Post-cutover stabilization docs and helper scripts were added for installing/removing the new `systemd` service safely.
- Added day-2 production helper scripts for status checks and repeatable server updates.
- Production cutover to the new web stack is completed, legacy data imported, and the home server now runs only `newscast_web_prod`.
- Legacy Streamlit code, old docs archive and leftover local build artifacts were removed from `main`; the repository is now `web-only`.
- Added a fast local dev workflow with hot-reload `web-dev` compose and helper scripts, so UI/backend changes can be checked without rebuilding production.
