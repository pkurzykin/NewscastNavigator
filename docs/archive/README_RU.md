---
type: index
status: active
owner: documentation-steward
audience: developers, agents
reviewed: 2026-09-30
---

# Архив проекта

Здесь находятся завершённые планы, исследования и материалы прежних этапов.
Их поручения, статусы, разрешения и «следующие шаги» относятся к дате источника.
Текущие требования и работа определяются [каталогом](../README_RU.md) и
[состоянием проекта](../PROJECT_STATE_RU.md).

## Сохранность и доступность

[Карта переноса](../reports/2026-09-30-documentation-map.json) учитывает каждый
исходный Markdown и связанные tracked материалы с SHA-256 исходного содержимого.
Исторические отчёты сохраняют фактически заявленные результаты; реорганизация
не означает повторного выполнения старых проверок.

## Замороженные свидетельства

Девять файлов сохранены побайтно на исходных путях: evaluator и исторические
Git-привязки используют эти пути и хеши. Они исключены из действующей документации
и не дописываются. [Манифест](EVIDENCE_MANIFEST.json) проверяется автоматически.

| Исторический файл | Назначение |
|---|---|
| [ARCHITECTURE_INVENTORY_RU.md](../../docs/product-reset/ARCHITECTURE_INVENTORY_RU.md) | свидетельство прежнего снимка / вход исторического evaluator |
| [DEMO_EVIDENCE.json](../../docs/product-reset/DEMO_EVIDENCE.json) | свидетельство прежнего снимка / вход исторического evaluator |
| [EVAL_COMMANDS.json](../../docs/product-reset/EVAL_COMMANDS.json) | свидетельство прежнего снимка / вход исторического evaluator |
| [EVAL_RESULT.json](../../docs/product-reset/EVAL_RESULT.json) | свидетельство прежнего снимка / вход исторического evaluator |
| [LEGACY_DENYLIST.txt](../../docs/product-reset/LEGACY_DENYLIST.txt) | свидетельство прежнего снимка / вход исторического evaluator |
| [OPERATIONS_INVENTORY_RU.md](../../docs/product-reset/OPERATIONS_INVENTORY_RU.md) | свидетельство прежнего снимка / вход исторического evaluator |
| [PROGRESS.md](../../docs/product-reset/PROGRESS.md) | завершённый журнал |
| [RISK_REGISTER_RU.md](../../docs/product-reset/RISK_REGISTER_RU.md) | свидетельство прежнего снимка / вход исторического evaluator |
| [UX_EVAL_RU.md](../../docs/product-reset/UX_EVAL_RU.md) | свидетельство прежнего снимка / вход исторического evaluator |

Внутренние ссылки замороженных файлов записаны для первоначального checkout.
Для точного воспроизведения читать их на исходном Git SHA; текущее расположение
перенесённых материалов приведено в карте. В UX-оценке 15.09 есть 11 ссылок на
9 локальных PNG `UI_SYSTEM/ux/after`, которых в исходном checkout нет. Старые
локальные evidence и ignored-файлы не обещаются как часть клона репозитория.
Новые снимки не подменяют эти исторические доказательства.

## Материалы по темам

### Документация — 2026

- [Реорганизация и сопровождение документации](2026-documentation/2026-09-30-documentation-system.md) — завершённый план.

### 2026-design

- [Производство — первый вариант для обсуждения](2026-design/2026-09-06-paper-production/README-v1_RU.md)
- [Производство — утверждённый вариант 2](2026-design/2026-09-06-paper-production/README_RU.md)
- [Производство — утверждённый визуальный эталон](2026-design/2026-09-06-paper-production/approved-baseline/README_RU.md)
- [Сценарий — вариант 2, синяя шапка восстановлена](2026-design/2026-09-06-paper-scenario/README_RU.md)
- [Сценарий — утверждённый визуальный эталон](2026-design/2026-09-06-paper-scenario/approved-baseline/README_RU.md)
- [Сюжеты — первый макет Paper](2026-design/2026-09-06-paper-stories/README_RU.md)
- [Сюжеты — утверждённый визуальный эталон](2026-design/2026-09-06-paper-stories/approved-baseline/README_RU.md)
- [Основной шрифт, стартовый шаблон и архив](2026-design/2026-09-13-paper-font-template-archive/README_RU.md)
- [Сценарий — чтение и доступ к редактированию](2026-design/2026-09-13-paper-scenario-access/README_RU.md)
- [Сюжеты: автор, исполнители и смена автора](2026-design/2026-09-13-paper-stories-author/README_RU.md)
- [Редактор в общем стиле — локальный макет](2026-design/2026-09-14-local-editor-style/README_RU.md)
- [Проба общего стиля для самой таблицы редактора](2026-design/2026-09-14-paper-editor-style/README_RU.md)
- [NewscastNavigator — общий дизайн-чекпойнт](2026-design/DESIGN_CHECKPOINT_RU.md)
- [Учёт вызовов Paper](2026-design/PAPER_USAGE_RU.md)
- [NewscastNavigator — общий список доработок](2026-design/WORK_ITEMS_RU.md)

### 2026-editor-planning

- [Архив и доступ к редактированию — дополнение к списку доработок](2026-editor-planning/2026-09-13-archive-and-edit-access/REQUIREMENTS_RU.md)
- [Список сюжетов и редактор — Implementation Plan](2026-editor-planning/2026-09-13-author-and-typing/IMPLEMENTATION_PLAN_RU.md)
- [Список сюжетов и редактор — требования к доработкам](2026-editor-planning/2026-09-13-author-and-typing/REQUIREMENTS_RU.md)
- [Основной шрифт и стартовый шаблон сценария](2026-editor-planning/2026-09-13-font-and-initial-template/REQUIREMENTS_RU.md)
- [R-012 — читаемые изменения и рабочие действия Истории](2026-editor-planning/2026-09-15-history-review/REQUIREMENTS_RU.md)

### 2026-history-ui

- [Final fix: semantic history and notification comparison](2026-history-ui/final-fix-report.md)

### 2026-hostland-migration

- [Hostland: первоначальный доступ и firewall — Implementation Plan](2026-hostland-migration/plans/2026-09-20-hostland-initial-hardening.md)
- [Hostland: ОС и Docker — Implementation Plan](2026-hostland-migration/plans/2026-09-20-hostland-os-runtime.md)
- [Hostland: синтетическая установка и полный backup — Implementation Plan](2026-hostland-migration/plans/2026-09-20-hostland-synthetic-rehearsal.md)
- [Hostland: первичное обследование перед переездом](2026-hostland-migration/specs/2026-09-20-hostland-migration-inventory.md)
- [Hostland: ОС и Docker — результаты второго этапа](2026-hostland-migration/specs/2026-09-20-hostland-os-runtime-result.md)
- [Переезд NewscastNavigator на Hostland: стратегия](2026-hostland-migration/specs/2026-09-20-hostland-production-migration-design.md)
- [Hostland: результат закрытой репетиции и полного backup](2026-hostland-migration/specs/2026-09-20-hostland-synthetic-rehearsal-result.md)
- [Hostland CP4–CP5: закрытая репетиция 23.09.2026](2026-hostland-migration/specs/2026-09-23-hostland-cp4-cp5-result.md)
- [Hostland CP6: готовность закрытого контура — 23.09.2026](2026-hostland-migration/specs/2026-09-23-hostland-cp6-readiness.md)

### 2026-operations

- [Автоматическое хранение production-копий — 28.09.2026](2026-operations/2026-09-28-auto-backup-retention.md)
- [Эксплуатационные проверки и восстановление копирования — 28.09.2026](2026-operations/2026-09-28-operations-recovery.md)

### 2026-product-rebuild

- [Управление сотрудниками и обязательная смена временного пароля](2026-product-rebuild/ADMIN_USERS_CORRECTION_DESIGN_RU.md)
- [Управление сотрудниками и обязательная смена временного пароля — Implementation Plan](2026-product-rebuild/ADMIN_USERS_CORRECTION_IMPLEMENTATION_PLAN_RU.md)
- [Критерии готовности продукта: документ перенесён](2026-product-rebuild/EVAL_RUBRIC_RU.md)
- [NewscastNavigator Product Reset — запуск Codex Plan и Goal](2026-product-rebuild/GOAL_PROMPTS_RU.md)
- [Коррекция интерфейса редакций и истории](2026-product-rebuild/HISTORY_UI_CORRECTION_DESIGN_RU.md)
- [Semantic History and Hidden Technical Revisions Implementation Plan](2026-product-rebuild/HISTORY_UI_CORRECTION_IMPLEMENTATION_PLAN_RU.md)
- [Уточнённый file-level план Product Reset NewscastNavigator](2026-product-rebuild/IMPLEMENTATION_PLAN_RU.md)
- [Материалы: веб-ссылки и копирование путей](2026-product-rebuild/MATERIAL_LINKS_PLAN_RU.md)
- [Управление приоритетом и даты в реестре сюжетов](2026-product-rebuild/PRIORITY_AND_TIMESTAMPS_DESIGN_RU.md)
- [Управление приоритетом и даты реестра — Implementation Plan](2026-product-rebuild/PRIORITY_AND_TIMESTAMPS_IMPLEMENTATION_PLAN_RU.md)
- [Подготовка NewscastNavigator 1.3.0](2026-product-rebuild/RELEASE_1_3_0_READINESS_RU.md)
- [Спецификация продукта: документ перенесён](2026-product-rebuild/SPEC_RU.md)
- [UI polish — approved September 20 implementation](2026-product-rebuild/UI_POLISH_2026_09_20_PLAN.md)
- [Дизайн-система и редактор — итог локальной работы](2026-product-rebuild/UI_SYSTEM_HANDOFF_RU.md)
- [Дизайн-система и редактор — утверждённый план внедрения](2026-product-rebuild/UI_SYSTEM_IMPLEMENTATION_PLAN_RU.md)
- [Локальная проверка после возвращения пользователя](2026-product-rebuild/UI_SYSTEM_LIVE_CHECK_RU.md)
- [Финальный обзор ветки UI System](2026-product-rebuild/UI_SYSTEM_REVIEW_RU.md)
- [Выбранный дизайн таблицы и очистка frontend](2026-product-rebuild/UI_SYSTEM_STYLE_CLEANUP_RU.md)
- [Визуальная доводка рабочих экранов и редактора](2026-product-rebuild/UI_SYSTEM_VISUAL_POLISH_RU.md)
- [NewscastNavigator 1.0.1 — управление сотрудниками и версия приложения](2026-product-rebuild/V1_0_1_USER_MANAGEMENT_AND_RELEASE_DESIGN_RU.md)
- [NewscastNavigator 1.0.1 — управление сотрудниками и версия приложения — Implementation Plan](2026-product-rebuild/V1_0_1_USER_MANAGEMENT_AND_RELEASE_IMPLEMENTATION_PLAN_RU.md)
- [NewscastNavigator 1.1.0 — шапка сценария и экспорт DOCX](2026-product-rebuild/V1_1_0_SCENARIO_DOCX_EXPORT_DESIGN_RU.md)
- [NewscastNavigator 1.1.0 — шапка сценария и экспорт DOCX — Implementation Plan](2026-product-rebuild/V1_1_0_SCENARIO_DOCX_EXPORT_IMPLEMENTATION_PLAN_RU.md)
- [NewscastNavigator 1.1.0 — корректировка форматирования DOCX — Implementation Plan](2026-product-rebuild/V1_1_0_SCENARIO_DOCX_FORMATTING_ADJUSTMENT_IMPLEMENTATION_PLAN_RU.md)
- [NewscastNavigator 1.1.1 — визуальные исправления экспорта DOCX](2026-product-rebuild/V1_1_1_SCENARIO_DOCX_VISUAL_FIXES_DESIGN_RU.md)
- [NewscastNavigator 1.1.1 — визуальные исправления DOCX — Implementation Plan](2026-product-rebuild/V1_1_1_SCENARIO_DOCX_VISUAL_FIXES_IMPLEMENTATION_PLAN_RU.md)
- [NewscastNavigator v1.1.2 — дизайн срочных полевых исправлений](2026-product-rebuild/V1_1_2_FIELD_HOTFIX_DESIGN_RU.md)
- [NewscastNavigator v1.1.2 и v1.2.0 — план реализации полевых исправлений](2026-product-rebuild/V1_1_2_V1_2_0_FIELD_CORRECTIONS_IMPLEMENTATION_PLAN_RU.md)
- [NewscastNavigator v1.2.0 — дизайн редакторских инструментов](2026-product-rebuild/V1_2_0_EDITOR_TOOLS_DESIGN_RU.md)

© 2026 Павел Курзыкин. Все права защищены.
