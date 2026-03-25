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
- Added a fast local dev workflow: native local runners are now the recommended default on this Mac, while hot-reload `web-dev` compose remains as a secondary option.
- The editor table now supports manual column resizing, clarifies the difference between a single project note and the comment feed, and no longer blocks save on placeholder-only `СНХ` rows.
- `EDITOR` was recomposed: table header fields are now embedded into the table block, the project files block and file path are moved above the table, and the service note is removed from the UI.
- `EDITOR` now saves table header fields together with the table, hides archive metadata outside archived projects, removes the helper text under the table, uses a sticky button toolbar above the table, and switches the project path to inline editing with automatic save.
- The editor toolbar is now rendered as a separate sticky block above the table so it stays fixed during page scroll; the redundant table heading was removed.
- Production helper scripts and the installed `systemd` unit are being aligned to the canonical root `compose.yaml` + `.env` server layout.
- `EDITOR` upgraded to `0.2.0`: added `ЗК+гео`, dropdown row creation, autosave for table/workflow/paths, a combined file+workflow layout, multi-path project roots, multi-select executors, a sticky formatting toolbar, auto-growing text fields, and a stacked `Имя файла / TC` cell.
- `EDITOR` text formatting now applies to selected fragments inside rich text fields, `ЗК+гео` and `Лайф` get italic defaults where needed, the `В кадре` column keeps only the column title while its placeholder text is `текст`, and compact `ФИО`/`Должность`/`Гео` fields now open at text height by default.
- Added cross-project planning docs for the next phase: `Story Exchange v1`, a full `EDITOR` layer RFC, and an integration roadmap for `NewscastNavigator`, `CaptionPanels`, and the future `Premiere` plugin.
- Added stable `segment_uid` identifiers for script rows as the first cross-project integration foundation for `Story Exchange`, cloning, and future downstream adapters.
- Added the first backend `Story Exchange v1` export foundation: canonical JSON serialization, a dedicated `/export/story-exchange` endpoint, mapping tests for `zk`/`zk_geo`/`snh`/`life`, and persisted JSON export artifacts.
- Added the first `CaptionPanels` adapter export on top of `Story Exchange`: `/export/captionpanels-import`, geotag expansion for `zk_geo`, `synch` mapping for `snh/life`, and backend tests for the downstream JSON contract.
- Started the `editor layer` foundation on the backend: `rich_text_json` storage for script rows, `/editor` rich-text round-trip support, compatibility synthesis from plain text + formatting defaults, and tests for the new data contract.
- Started the frontend `editor-core` pilot on `Tiptap` for simple text blocks (`Подводка`, `ЗК`, `Лайф`): toolbar commands now work through editor commands in the pilot fields, while structured rows still stay on the legacy rich-text layer until the next step.
- Extended the frontend `editor-core` pilot to `СНХ`: `ФИО`, `Должность` and the sync text now run through `Tiptap`, while `ЗК+гео` still stays on the legacy rich-text layer for the next isolated step.
- Extended the frontend `editor-core` pilot to `ЗК+гео`: `Гео` and the main text now also run through `Tiptap`, so the full current block set is covered by the new editor layer before legacy rich-text cleanup.
- Removed the legacy `contenteditable/execCommand` rich-text path from `EditorPage`: the current `EDITOR` now uses a single `editor-core` path based on `Tiptap`.
- Cross-project integration planning now explicitly targets the real `CaptionPanels` UX: the user selects a concrete `NewscastNavigator` project in the plugin and then creates subtitles from that selected project with one main action, while manual JSON export stays as a fallback/debug path.
