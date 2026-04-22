# Docs Rebaseline Design

Date: 2026-04-22
Status: approved and implemented
Scope: documentation information architecture cleanup

## 1. Context

`docs/` contained a mix of active source-of-truth, historical migration/sprint plans, and RFC drafts. This made it hard to identify current operational guidance and current architecture decisions.

The user requested:

- full state snapshot;
- documentation cleanup with archival of completed materials;
- a clear next-step plan based on current reality.

## 2. Decision

Chosen approach: `hybrid`.

- Keep only active operational and architecture docs in `docs/`.
- Move live integration contracts to `docs/contracts/`.
- Move completed plans and historical RFCs/checklists to `docs/archive/2026-04/`.

## 3. Target structure

Active root (`docs/`):

- `README_RU.md`
- `PROJECT_WORKFLOW_ARCHITECTURE_RU.md`
- `STATE_SNAPSHOT_AND_NEXT_STEPS_RU.md`
- `ENGINEERING_PLAN_RU.md`
- `DEPLOYMENT_UBUNTU_RU.md`
- `LOCAL_DEV_WORKFLOW_RU.md`
- `WEB_SMOKE_CHECKLIST_RU.md`
- `LEGACY_DATA_MIGRATION_RU.md`

Contracts (`docs/contracts/`):

- `STORY_EXCHANGE_RFC_RU.md`
- `INTEGRATION_ROADMAP_RU.md`

Archive (`docs/archive/2026-04/`):

- Sprint checklists
- migration/parity/cleanup plans
- implemented RFC/UX plans
- historical stabilization/audit runbooks

## 4. Implementation notes

- Rewrote `docs/README_RU.md` into a status index (`ACTIVE`, `CONTRACT`, `ARCHIVE`).
- Updated `PROJECT_WORKFLOW_ARCHITECTURE_RU.md` to reflect implemented status and current backlog.
- Added `STATE_SNAPSHOT_AND_NEXT_STEPS_RU.md` as a durable state + roadmap document.
- Updated root `README.md` docs section to valid, current paths.

## 5. Acceptance criteria

- Root `docs/` is compact and contains only active documentation.
- Contracts are separated from general docs.
- Archived materials are preserved and discoverable by month.
- Team can answer "what is current source of truth?" in under 30 seconds.
- No broken references in main README docs list.

## 6. Risks and mitigation

Risk: accidental archival of still-active RFC content.
Mitigation: only two integration contracts were kept active under `docs/contracts/`; all moved files remain recoverable in archive.

Risk: future drift between implementation and active architecture docs.
Mitigation: `STATE_SNAPSHOT_AND_NEXT_STEPS_RU.md` added as a maintenance point to refresh after major milestones.
