# UI polish — approved September 20 implementation

Status: implementation completed locally; scoped reviews approved, final whole-change review in progress. User accepted both Paper mockups and explicitly authorized implementation without further Paper calls. Extends the approved file-level audit at /Volumes/work/Projects/NewscastNavigator/artifacts/planning/2026-09-20-design-audit/README_RU.md.
Base: 7d4c20ca2be449e96ada32d67654da05cfa0d21f; branch codex/ui-polish-2026-09-20.
Spec: SPEC_RU.md, EVAL_RUBRIC_RU.md, docs/design/UI_SYSTEM_RU.md and the accepted artifact README.

## Global Constraints

- No Paper MCP calls. No CodeRabbit, push, PR, merge, external deploy, secrets or real data.
- Existing React/MUI9.4/Emotion, Onest and CSS tokens are the only design system. Replace old affected CSS, do not append parallel overrides.
- Keep the scenario editor including blue header, content fonts, autosave, stable IDs and CaptionPanels unchanged.
- One internal correction part; multiple external parts. Preserve server permissions, assignee options and payloads.
- Preserve notification targets/grouping/explicit mark-read, history links, prior items on refresh failure and stale-response guards. No new bulk-read/filter features.
- Preserve meaningful event summary, actor/time only from available data, keyboard/focus, pending/draft-on-error behavior.
- Synthetic tests, meaningful RED before behavior changes, full frontend and browser/build gates. Desktop 1366x768 and 1920x1080. No mobile redesign.
- Checkpoint documentation/PROGRESS, local commits and independent Codex review. Use existing restored worktree; product main untouched.
- Stop safely if Codex remaining quota reaches 3%.

## Task 1: Correction forms

Read accepted requirements in /Volumes/work/Projects/NewscastNavigator/artifacts/design/2026-09-20-paper-corrections-notifications/README_RU.md and visually inspect corrections-proposal.png beside it (no Paper). Ownership: frontend/src/features/corrections/components/CorrectionPackageDialog.tsx, optional small shared correction form fields component, frontend/src/features/external-approval/components/ExternalResultDialog.tsx, frontend/src/styles/corrections.css and external-approval.css, covering component tests and frontend/e2e/production-workflow.spec.ts or a focused new correction-forms.spec.ts.
Implement top row scope + assignee, full-width description, no internal Part 1 frame. Shared header close icon/accessible name, footer secondary Cancel and primary Save/Add; MUI buttons 32px/select36, UI text14px and labels13px, modest 8px shell radius and existing tokens. Form approx633px responsive to desktop available width. External parts numbered with remove/add controls, same fields. Constrain modal to viewport; scroll only body, header/footer remain accessible. Focus description, retain data and focus on error, prevent duplicate mutation, maintain ESC/return focus semantics.
TDD: establish missing compact semantic labels/header/internal no-part-heading and external unified controls behavior with meaningful component/browser tests, preserve existing assignee+payload and multi-part tests. Cosmetic CSS alone need not get implementation-mirroring unit tests; browser geometry assertions may substantiate full-width description/viewport footer. Run targeted tests while iterating, full npm test -- --run and npm run build before report. Root handles live Docker rebuild and combined browser pass.
Expected: all new and existing tests pass, no redundant old 3-column CSS, draft remains on mutation failure, no domain/API changes.
Commit only owned changes and write report with RED/GREEN/full suite/build commands and results. Do not edit shared PROGRESS (root owns checkpoint log). Do not spawn other agents.

## Task 2: Notifications and attention queue

Read same accepted artifact README and notifications-proposal.png. Ownership: frontend/src/features/notifications/components/{NotificationTray,AttentionQueue}.tsx, optional small formatter/NotificationDiff component within notifications feature, frontend/src/styles/notifications.css, notification/attention component tests and frontend/e2e/notification-routing.spec.ts or a focused notification design spec.
Implement compact460px panel using existing MUI controls and tokens. Rows: blue unread dot fixed8px lane, 14px semibold event, 13px story, 12px actor/time (existing project timezone formatting), 32px explicit mark-read icon with tooltip and Russian accessible label, 13px actions. Preserve all meaningful summaries, allowing extra lines for actual content. Show close control and max available viewport height/scroll. Diff toggle must read collapsed/expanded correctly, actual semantic before/after with color+non-color indicators, empty added/removed/moved row explanation instead of dashes. Use actual history row field contracts and allow formatting/metadata changes to remain discoverable. Distinguish initial loading/error/empty and retry; retain previous items on transient refresh errors, keep serialized refresh protection. Preserve mark-read failure visibility, link behavior and focus return/escape.
Fix AttentionQueue Russian number agreement (10 действий) in code rather than CSS fixed suffix, and wrap long context/actions without breaking compact three-item preview/empty state.
TDD: collapse/reopen diff, actual row snapshots including deleted empty row and formatted content, initial load failure retry and late polling/mark-read race, unread explicit action semantics, attention plural and long-row layout. Run targeted tests, full frontend suite/build. Root owns live visual pass and full e2e.
Expected: no lost summary/text, no stale item reappearance, no new permissions/API, compact visible actions and accessible links.
Commit owned changes, report RED/GREEN/full suite/build results. No subagents.

## Task 3: Integration, remaining design audit and documentation

Inspect remaining standard dialogs and short history events against accepted system. Implement only proven discrepancies from approved audit; preserve workflow/functional behavior. Update SPEC_RU.md and EVAL_RUBRIC_RU.md stale statement that the September14 table was deferred, corresponding UI_SYSTEM_IMPLEMENTATION_PLAN_RU.md line, handoff restored worktree/preview build instructions, docs/design/UI_SYSTEM_RU.md accepted corrections/notification patterns, PROGRESS.md and this plan status.
Rebuild local synthetic ncn-ui-system-preview from restored checkout; do not reseed preserved DB. Run full frontend/browser/build and backend suite when available; inspect meaningful rendered states on both desktop sizes, long external modal, focus, errors, notifications/diff. Remove replaced styles, review diff independently, resolve important findings, save exact evidence and local checkpoint commits. No external integration.
