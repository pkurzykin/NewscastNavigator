# Changelog

## Unreleased

- Repository initialized as web-first.
- Legacy Streamlit MVP moved to `legacy/streamlit_mvp/`.
- GitHub repository connected and `main` published.
- Project workflow parity moved into the web stack: statuses, assignments, history, archive metadata and richer filters.
- `EDITOR`/`WORKSPACE` now use shared project metadata helpers, and `proofreader` edit rules are aligned with the legacy workflow.
- Backend API smoke tests added for roles, archive/restore, editor/workspace metadata, history and exports.
- Added production deploy foundation for the web stack: prod compose, prod Dockerfiles, nginx, backup scripts and server-audit checklist.
- Added a read-only server audit snapshot script for safe inventory of the existing home server state.
