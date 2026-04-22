# Workflow UX Stabilization Plan

Date: 2026-04-22
Status: ready for implementation
Owner: NewscastNavigator web stack

## 1. Goal

Close the remaining gap between existing action-comment mechanics and daily newsroom execution flow:

- make "what needs my action now" explicit;
- make it obvious what changed in text/revision since a task was created;
- shorten the path from task to exact project area that must be fixed.

## 2. Scope

In scope:

- UX improvements for action comments in `Main` and `Editor`;
- explicit per-comment staleness signal (`text changed since task was set`);
- quick navigation from queue item to linked project context;
- tighter lifecycle states for assigned tasks (`open`, `in_progress`, `resolved`).

Out of scope:

- new role model redesign;
- realtime collaborative editor;
- cross-repo/plugin-side changes in CaptionPanels.

## 3. Functional changes

### 3.1 Main queue clarity

- Add a dedicated "My actionable tasks" group with stable sorting:
  1. assigned to me + open
  2. assigned to me + in progress
  3. recently resolved by me
- Show compact badges for task target kind (`text`, `edit`, `titles`, `voiceover`, `final_review`, `other`).

### 3.2 Staleness indicator for designers and editors

- For each action comment, compute whether current project `text_seq` is newer than `text_seq` captured at task creation.
- Render explicit warning state:
  - "Text changed after task creation" with stored `from_seq -> current_seq`.
- Provide one-click jump to diff endpoint/context used by existing text state APIs.

### 3.3 Task lifecycle UX

- Keep current backend workflow fields, but make transitions obvious in UI:
  - `Open` -> `Take in work` -> `Resolve`
  - `In progress` -> `Release` (back to open)
  - `Resolved` -> `Reopen`
- Add small transition notes to history feed for each state change.

### 3.4 Project focus reason

- In queue/project cards, display one normalized reason string:
  - "Assigned action is waiting"
  - "Task in progress requires update"
  - "Resolved task reopened"
- Reuse current backend counters/signals where possible; avoid new heavy backend state.

## 4. Backend plan

- Reuse existing action comment payload and staleness data (`text_seq` snapshots).
- Add one normalized computed field for queue reason if needed by frontend:
  - `focus_reason` (string enum).
- Ensure list endpoints provide enough data to avoid N+1 reloads in `Main`.

No schema migration expected for this step unless a missing flag is discovered during implementation.

## 5. Frontend plan

- `MainPage`:
  - refine filtering/grouping for personal task queue;
  - render target badges and focus reason labels;
  - add direct deep-link/open action to project + comment context.
- `EditorPage`:
  - show staleness warning on relevant comments;
  - add clear workflow action buttons with guarded states;
  - expose quick diff action when staleness is detected.

## 6. Test plan

Backend:

- extend smoke/API tests for queue reason computation (if added);
- verify lifecycle transitions remain role-safe.

Frontend:

- add interaction tests (or minimal integration checks) for:
  - queue grouping,
  - staleness warning visibility,
  - state transition button availability.

Manual smoke:

- designer flow: task assigned -> text changes -> warning visible -> diff open -> task updated/resolved;
- chief editor flow: reopen resolved task and verify assignee queue updates.

## 7. Delivery slices

Slice 1:

- Main queue regrouping + target badges + focus reason labels.

Slice 2:

- Editor action-comment lifecycle controls and clearer transitions.

Slice 3:

- Staleness warning + quick diff path polish + final smoke pass.

## 8. Definition of done

- Assigned users can instantly see and process their pending action tasks.
- Designer/editor can clearly detect text drift after task creation.
- Task lifecycle transitions are visible, predictable, and auditable in history.
- No regression in existing action-comment tests and project workflows.
