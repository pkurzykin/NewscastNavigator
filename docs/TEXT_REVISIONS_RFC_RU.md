# TEXT REVISIONS RFC

## Версионирование текстов в Newscast Navigator

Статус на 2026-03-26:

* Phase 1 реализован: snapshot revision layer, lazy baseline, restore/current, базовый UI.
* Phase 2 реализован: backend diff API и базовый diff preview в `EDITOR`.
* Phase 3 workflow реализован: `submit/approve/reject`, ветки по `branch_key`, branch/merge actions и UI-управление статусами готовы.

---

## 1. Контекст

В текущей реализации `Newscast Navigator`:

* текст проекта хранится в `script_elements`;
* редактор работает с **живым состоянием** (workspace);
* изменения перезаписывают текущее состояние;
* есть `project_events`, но это **лог действий**, а не история текста.

Проблемы:

* нет полноценной истории изменений текста;
* невозможно корректно сравнить версии;
* нет возможности откатиться к предыдущему состоянию;
* невозможно реализовать нормальный редакционный workflow:

  * корреспондент → шеф → корректор → финал;
* нет поддержки параллельных правок.

---

## 2. Цель

Добавить в систему **версионирование текста (revision layer)**, которое:

* сохраняет каждую осмысленную правку как **immutable snapshot**;
* позволяет:

  * просматривать историю;
  * сравнивать версии;
  * восстанавливать версии;
  * отмечать текущую (approved) версию;
* не ломает текущий editor workflow;
* закладывает основу под редакционный workflow.

---

## 3. Основная концепция

### Разделение состояний

| Сущность  | Назначение                      |
| --------- | ------------------------------- |
| Workspace | текущее редактируемое состояние |
| Revision  | неизменяемый снимок текста      |

---

### Ключевые принципы

1. **Revision неизменяема**
2. Любая фиксация текста = новая revision
3. Workspace можно менять, revision — нет
4. Храним **полный snapshot**, а не только diff
5. Всегда есть:

   * current revision (утвержденная)
   * рабочий draft (workspace)

---

## 4. Архитектура

```
Project
 ├── Workspace (script_elements)
 ├── Revisions
 │     ├── Revision v1
 │     ├── Revision v2
 │     ├── Revision v3
 │
 └── Current Revision → v3
```

---

## 5. Модель данных

### 5.1 project_revisions

| поле               | тип       | описание                     |
| ------------------ | --------- | ---------------------------- |
| id                 | UUID      | id ревизии                   |
| project_id         | UUID      | ссылка на проект             |
| revision_no        | int       | номер версии                 |
| parent_revision_id | UUID      | родитель                     |
| branch_key         | string    | main / chief / proof / merge |
| revision_kind      | string    | тип ревизии                  |
| status             | string    | draft / approved / rejected  |
| title              | string    | название                     |
| comment            | text      | комментарий                  |
| created_by         | UUID      | пользователь                 |
| created_at         | timestamp | дата                         |
| is_current         | bool      | текущая версия               |

---

### 5.2 project_revision_elements

Snapshot строк:

| поле            | описание                 |
| --------------- | ------------------------ |
| revision_id     | связь                    |
| segment_uid     | стабильный идентификатор |
| order_index     | порядок                  |
| block_type      | тип блока                |
| text            | текст                    |
| speaker_text    | спикер                   |
| file_name       | файл                     |
| tc_in/out       | таймкоды                 |
| content_json    | структура                |
| formatting_json | формат                   |
| rich_text_json  | rich                     |

---

## 6. Основные сценарии

### 6.1 Создание ревизии

1. Пользователь редактирует workspace
2. Нажимает “Создать версию”
3. Backend:

   * создает запись revision
   * копирует все script_elements

---

### 6.2 Восстановление

1. Выбор revision
2. “Restore”
3. Workspace перезаписывается snapshot’ом

---

### 6.3 Mark current

1. Выбор revision
2. “Make current”
3. Обновляется is_current

---

## 7. Diff логика

### Основа

Сравнение по `segment_uid`

---

### Типы изменений

| тип     | условие               |
| ------- | --------------------- |
| added   | есть только в новой   |
| removed | есть только в старой  |
| changed | payload отличается    |
| moved   | изменился order_index |

---

### Сравниваемые поля

* block_type
* text
* speaker_text
* file_name
* tc_in/out
* content_json
* formatting_json
* rich_text_json

---

## 8. API

### Получить список ревизий

GET /projects/{id}/revisions

---

### Создать ревизию

POST /projects/{id}/revisions

---

### Получить ревизию

GET /projects/{id}/revisions/{revision_id}

---

### Получить элементы

GET /projects/{id}/revisions/{revision_id}/elements

---

### Diff

GET /projects/{id}/revisions/{revision_id}/diff?against=...

---

### Restore

POST /projects/{id}/revisions/{revision_id}/restore-to-workspace

---

### Mark current

POST /projects/{id}/revisions/{revision_id}/mark-current

---

### Submit

POST /projects/{id}/revisions/{revision_id}/submit

---

### Approve

POST /projects/{id}/revisions/{revision_id}/approve

---

### Reject

POST /projects/{id}/revisions/{revision_id}/reject

---

## 9. Event logging

Добавить события:

* revision_created
* revision_restored_to_workspace
* revision_marked_current
* revision_submitted
* revision_approved
* revision_rejected
* revision_merged

---

## 10. Frontend

### Панель “Версии”

Отображает:

* список ревизий
* номер
* автор
* дата
* статус
* комментарий
* current

---

### Действия

* создать версию
* открыть
* diff
* restore
* mark current

---

### Diff UI (MVP)

* список измененных блоков
* цветовая индикация:

  * зелёный — добавлено
  * красный — удалено
  * жёлтый — изменено
  * синий — перемещено

---

## 11. Этапы внедрения

### Этап 1 — Backend foundation

* модели
* миграции
* CRUD
* snapshot
* restore
* mark current

---

### Этап 2 — Diff

* сервис diff
* API

---

### Этап 3 — Frontend MVP

* панель версий
* действия
* diff

---

### Этап 4 — Bootstrap

* baseline revision для старых проектов

---

### Этап 5 — Workflow

* submit
* approve
* reject
* branch
* merge

---

## 12. Тестирование

Покрыть:

* создание ревизии
* восстановление
* mark current
* diff:

  * added
  * removed
  * changed
  * moved

---

## 13. Нефункциональные требования

* не ломать текущий editor
* без legacy
* через migration
* без hardcoded логики
* обновить docs
* добавить smoke-тесты

---

## 14. Дальнейшее развитие

* ветки (chief / proof)
* merge ревизий
* inline review
* принятие/отклонение правок
* интеграция с CaptionPanels
* привязка к ассетам (видео/аудио)

---

## 15. Итог

Добавляется слой:

**Workspace + Revision History**

Это превращает редактор из “формы ввода текста” в полноценную **редакционную систему управления контентом**.

---
