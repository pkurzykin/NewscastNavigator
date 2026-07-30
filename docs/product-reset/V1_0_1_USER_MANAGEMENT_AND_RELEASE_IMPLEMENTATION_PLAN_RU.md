# NewscastNavigator 1.0.1 — управление сотрудниками и версия приложения — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выпустить минимальный патч `1.0.1`: разрешить начальнику менять логин сотрудника, безопасно удалять только неиспользованную учётную запись, показать единый номер версии в компактном футере и исключить запуск устаревшего frontend после production cutover.

**Architecture:** Backend остаётся единственным источником разрешений и инвариантов. Изменение логина расширяет существующий `PATCH`, а удаление сначала блокирует строку пользователя, затем fail-closed проверяет все внешние ключи на `users.id`; удаляемыми считаются только явно разрешённые технические связи. Frontend использует существующую command/refetch-модель. Версия берётся из package metadata и проверяется между backend/frontend. Nginx ревалидирует HTML, но бессрочно кеширует только content-hashed assets.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy 2, PostgreSQL, React 18, TypeScript, Vite, Vitest, Testing Library, Playwright, Nginx, Docker Compose.

## Global Constraints

- Не менять утверждённую Product Reset модель, сценарий, workflow, CaptionPanels или табличный редактор.
- Удалять можно только ошибочно созданную и ещё не использованную учётную запись.
- Текущего пользователя и последнего активного начальника удалить нельзя.
- Любая неизвестная доменная или историческая ссылка блокирует удаление.
- Функции, сессии, маркеры чтения и уведомления только для получателя являются техническими связями и могут удаляться вместе с допустимым пользователем.
- Смена логина не меняет пароль, `must_change_password` и активную сессию.
- Все команды остаются chief-only и повторно проверяются backend.
- Существующий production-admin и его password hash сохраняются без чтения или вывода plaintext.
- Номер версии относится к приложению, а не возвращает пользовательские версии сценария.
- Миграция БД не создаётся.
- Production cutover пересобирает и заменяет только `backend` и `frontend`; `db` и `gateway` не пересоздаются.
- Реальные сотрудники, пароли, production `.env` и другие секреты не попадают в тесты, логи, документы или Git.
- Push, PR, merge и deploy выполняются только после зелёной локальной матрицы; разрешение владельца на этот выпуск уже получено.

---

## Карта файлов

**Backend user management**

- `backend/app/schemas/admin.py` — optional `username` в `AdminUserUpdate`.
- `backend/app/api/routes/admin.py` — login update, `DELETE /users/{id}`, стабильные ошибки и транзакции.
- `backend/app/services/user_deletion.py` — fail-closed inventory всех FK на `users.id`.
- `backend/tests/test_admin.py` — rename/delete permissions, invariants, history references и cleanup.

**Frontend user management**

- `frontend/src/features/admin/types.ts` — update payload с `username`.
- `frontend/src/features/admin/api.ts` — `deleteAdminUser`.
- `frontend/src/features/admin/AdminUsersManager.tsx` — поле логина и confirmation dialog удаления.
- `frontend/src/features/admin/AdminUsersManager.test.tsx` — command/pending/error/refetch behavior.
- `frontend/e2e/fixtures/admin-users.ts` — PATCH username и DELETE fixture.
- `frontend/e2e/admin-users.spec.ts` — chief rename/delete/reject browser flow.

**Version и footer**

- `backend/pyproject.toml`
- `backend/app/core/version.py`
- `backend/tests/test_app_version.py`
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/vite.config.ts`
- `frontend/src/appVersion.ts`
- `frontend/src/components/AppFooter.tsx`
- `frontend/src/components/AppFooter.test.tsx`
- `frontend/src/components/app-shell/AppShell.tsx`
- `frontend/src/components/app-shell/AppShell.test.tsx`
- `frontend/src/App.tsx`
- `frontend/src/styles/layout.css`
- `CHANGELOG.md`

**Cache и эксплуатационный smoke**

- `frontend/nginx.prod.conf`
- `deploy/scripts/smoke.sh`
- `backend/tests/test_operations_contract.py`

**Release evidence**

- `backend/app/services/product_reset_eval.py`
- `backend/tests/test_product_reset_eval.py`
- `backend/tests/test_demo_evidence.py`
- `backend/tests/test_ux_eval_evidence.py`
- `docs/product-reset/DEMO_EVIDENCE.json`
- `docs/product-reset/EVAL_RESULT.json`
- `docs/product-reset/UX_EVAL_RU.md`
- `docs/product-reset/RISK_REGISTER_RU.md`
- `docs/product-reset/PROGRESS.md`

---

### Task 1: Backend — изменение логина и безопасное удаление

**Files:**

- Modify: `backend/tests/test_admin.py`
- Modify: `backend/app/schemas/admin.py`
- Create: `backend/app/services/user_deletion.py`
- Modify: `backend/app/api/routes/admin.py`

**Interfaces:**

- Produces: `AdminUserUpdate.username: str | None`.
- Produces: `find_user_deletion_blockers(db, *, user_id: int) -> tuple[str, ...]`.
- Produces: `PATCH /api/v1/admin/users/{user_id}` с нормализованным уникальным логином.
- Produces: `DELETE /api/v1/admin/users/{user_id} -> CommandAck`.
- Produces: `409 CANNOT_DELETE_SELF`.
- Produces: `409 USER_DELETE_BLOCKED`.
- Preserves: `409 LAST_CHIEF_REQUIRED` и `USERNAME_TAKEN`.

- [ ] **Step 1: Написать RED-тесты изменения логина**

В `backend/tests/test_admin.py` добавить:

```python
def test_chief_updates_normalized_unique_username_without_changing_password(client, db_session) -> None:
    before = _user_by_username(db_session, "runa")
    before_hash = before.password_hash
    before_must_change = before.must_change_password
    response = client.patch(
        f"/api/v1/admin/users/{before.id}",
        json={"username": "  runa-new  "},
        cookies=_cookies(client, "astra"),
    )
    assert response.status_code == 200, response.text
    db_session.expire_all()
    changed = _user_by_username(db_session, "runa-new")
    assert changed.password_hash == before_hash
    assert changed.must_change_password is before_must_change


def test_username_conflict_is_rejected_without_partial_profile_update(client, db_session) -> None:
    target = _user_by_username(db_session, "runa")
    response = client.patch(
        f"/api/v1/admin/users/{target.id}",
        json={"username": "astra", "display_name": "Не сохранять"},
        cookies=_cookies(client, "astra"),
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "USERNAME_TAKEN"
    db_session.expire_all()
    assert _user_by_id(db_session, target.id).display_name != "Не сохранять"
```

Также проверить: пустой/слишком длинный логин отвергается schema validation,
non-chief получает `403`, текущая сессия переименованного пользователя
остаётся действующей, новый login используется при следующем входе.

- [ ] **Step 2: Запустить rename-тесты и подтвердить RED**

Run:

```bash
cd backend
./.venv/bin/pytest -q tests/test_admin.py -k "username or login"
```

Expected: schema не принимает `username` либо PATCH игнорирует поле.

- [ ] **Step 3: Реализовать безопасное изменение логина**

В `AdminUserUpdate` применить существующий identity normalizer:

```python
class AdminUserUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=120)
    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    position: str | None = Field(default=None, min_length=1, max_length=120)
    function_codes: list[str] | None = None
    is_active: bool | None = None

    @field_validator("username", "display_name", "position", mode="before")
    @classmethod
    def normalize_identity(cls, value: object, info: ValidationInfo) -> str | None:
        if value is None:
            return None
        return normalize_identity_value(value, field_name=info.field_name)
```

В `update_user` блокировать пользователя также при изменении `username`,
назначать нормализованное значение и оборачивать commit:

```python
try:
    if payload.username is not None:
        user.username = payload.username
    # existing assignments
    db.commit()
except IntegrityError as exc:
    db.rollback()
    raise _error("USERNAME_TAKEN", "Логин уже используется") from exc
```

Никаких session revoke или password mutations при rename не выполнять.

- [ ] **Step 4: Написать RED-тесты удаления**

Добавить отдельные случаи:

```python
def test_chief_deletes_unused_user_and_technical_records(client, db_session) -> None:
    user = _create_unused_user_with_technical_records(db_session)
    response = client.delete(
        f"/api/v1/admin/users/{user.id}",
        cookies=_cookies(client, "astra"),
    )
    assert response.status_code == 200, response.text
    assert response.json()["resource"] == {"type": "user", "id": user.id}
    assert db_session.get(User, user.id) is None


def test_delete_blocks_every_domain_or_history_reference(client, db_session, reference_factory) -> None:
    user = _create_unused_user(db_session)
    reference_factory(db_session, user)
    response = client.delete(
        f"/api/v1/admin/users/{user.id}",
        cookies=_cookies(client, "astra"),
    )
    assert response.status_code == 409
    assert response.json()["error"] == {
        "code": "USER_DELETE_BLOCKED",
        "message": "Сотрудник уже участвовал в работе. Отключите учётную запись",
    }
```

Параметризовать `reference_factory` минимум по FK-классам:

- `RESTRICT`: author, assignment, material, scenario snapshot/edit session;
- `SET NULL`: story event actor, workflow/production/correction/external actor,
  notification actor;
- технический allowlist: functions, sessions, read markers, recipient-only
  notifications.

Отдельно проверить self-delete, last-chief, non-chief, missing user и
fail-closed `IntegrityError` на commit.

- [ ] **Step 5: Запустить delete-тесты и подтвердить RED**

Run:

```bash
cd backend
./.venv/bin/pytest -q tests/test_admin.py -k "delete"
```

Expected: route отвечает `405 Method Not Allowed`.

- [ ] **Step 6: Реализовать fail-closed FK inventory**

Создать `backend/app/services/user_deletion.py`:

```python
from sqlalchemy import literal, select
from sqlalchemy.orm import Session

from app.db.base import Base


NON_BLOCKING_USER_REFERENCES = frozenset({
    ("user_functions", "user_id"),
    ("user_sessions", "user_id"),
    ("scenario_read_markers", "user_id"),
    ("notifications", "recipient_user_id"),
})


def find_user_deletion_blockers(
    db: Session,
    *,
    user_id: int,
) -> tuple[str, ...]:
    blockers: list[str] = []
    for table in sorted(Base.metadata.tables.values(), key=lambda item: item.name):
        for foreign_key in sorted(
            table.foreign_keys,
            key=lambda item: item.parent.name,
        ):
            if (
                foreign_key.column.table.name != "users"
                or foreign_key.column.name != "id"
            ):
                continue
            reference = (table.name, foreign_key.parent.name)
            if reference in NON_BLOCKING_USER_REFERENCES:
                continue
            exists = db.scalar(
                select(literal(True))
                .select_from(table)
                .where(foreign_key.parent == user_id)
                .limit(1)
            )
            if exists:
                blockers.append(".".join(reference))
    return tuple(blockers)
```

Этот алгоритм блокирует новые FK по умолчанию. Новый технический FK сможет
разрешить удаление только после явного добавления в allowlist и теста.

- [ ] **Step 7: Реализовать DELETE route**

Route должен:

1. получить chief actor;
2. заблокировать target через `lock_user_for_credentials`;
3. отклонить `actor.id == target.id`;
4. вызвать `ensure_chief_invariant(..., next_is_active=False, next_function_codes=())`;
5. проверить `find_user_deletion_blockers`;
6. удалить пользователя и commit;
7. преобразовать неожиданный `IntegrityError` в тот же
   `409 USER_DELETE_BLOCKED`.

Для status-specific ошибок расширить `_error` параметром `status_code`, не
меняя существующие коды:

```python
def _error(
    code: str,
    message: str,
    *,
    status_code: int = status.HTTP_400_BAD_REQUEST,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )
```

- [ ] **Step 8: Подтвердить GREEN и commit backend checkpoint**

Run:

```bash
cd backend
./.venv/bin/pytest -q tests/test_admin.py tests/test_auth.py
```

Expected: все выбранные тесты проходят.

Commit:

```bash
git add backend/app/schemas/admin.py \
  backend/app/services/user_deletion.py \
  backend/app/api/routes/admin.py \
  backend/tests/test_admin.py
git commit -m "feat(admin): rename and safely delete employees"
```

---

### Task 2: Frontend — login edit и подтверждённое удаление

**Files:**

- Modify: `frontend/src/features/admin/types.ts`
- Modify: `frontend/src/features/admin/api.ts`
- Modify: `frontend/src/features/admin/AdminUsersManager.tsx`
- Modify: `frontend/src/features/admin/AdminUsersManager.test.tsx`
- Modify: `frontend/e2e/fixtures/admin-users.ts`
- Modify: `frontend/e2e/admin-users.spec.ts`

**Interfaces:**

- Produces: `UpdateAdminUserPayload.username?: string`.
- Produces: `deleteAdminUser(userId: number): Promise<CommandAck>`.
- Produces: accessible modal `Удалить сотрудника`.

- [ ] **Step 1: Написать RED component-тесты**

Добавить mock `deleteAdminUser` и проверить:

```tsx
it("submits a normalized login from the existing edit dialog", async () => {
  // open "Изменить Астра"
  // replace login with "  astra-new  "
  // preserve name/position/functions
  expect(apiMocks.updateAdminUser).toHaveBeenCalledWith(1, {
    username: "astra-new",
    display_name: "Астра",
    position: "Начальник",
    function_codes: ["chief"],
  });
});

it("confirms deletion by name and login, then refetches", async () => {
  // open DeleteDialog for unused employee
  expect(dialog).toHaveTextContent("Север");
  expect(dialog).toHaveTextContent("sever");
  // confirm and await success
  expect(apiMocks.deleteAdminUser).toHaveBeenCalledWith(3);
  expect(apiMocks.fetchAdminUsers).toHaveBeenCalledTimes(2);
});
```

Также проверить:

- conflict оставляет edit dialog и все значения открытыми;
- cancel не вызывает DELETE;
- pending блокирует все launch points и двойную отправку;
- `USER_DELETE_BLOCKED` показывается рядом со списком, dialog закрывается
  только после успешной команды;
- refetch failure после принятой команды не возвращает удалённый dialog.

- [ ] **Step 2: Запустить component-тесты и подтвердить RED**

Run:

```bash
cd frontend
npm test -- --run src/features/admin/AdminUsersManager.test.tsx
```

Expected: отсутствуют login input и delete command.

- [ ] **Step 3: Расширить frontend API и edit dialog**

В types:

```ts
export interface UpdateAdminUserPayload {
  username?: string;
  display_name?: string;
  position?: string;
  function_codes?: string[];
  is_active?: boolean;
}
```

В API:

```ts
export function deleteAdminUser(userId: number): Promise<CommandAck> {
  return requestJson<CommandAck>(`/api/v1/admin/users/${userId}`, {
    method: "DELETE",
  });
}
```

В `EditDialog` добавить controlled `username`, required input «Логин» и
отправлять `.trim()` вместе с текущими полями. Не закрывать dialog при
отклонённой команде.

- [ ] **Step 4: Добавить DeleteDialog в существующий manager**

Использовать существующий `ModalDialog`; нативный `window.confirm` не
использовать:

```tsx
function DeleteDialog({ user, submitting, error, onClose, onSubmit }: Props) {
  return (
    <ModalDialog labelledBy="admin-delete-title" pending={submitting} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        <h2 id="admin-delete-title">Удалить сотрудника</h2>
        <p>Будет удалён сотрудник <strong>{user.display_name}</strong> ({user.username}).</p>
        <p>Если сотрудник уже участвовал в работе, система предложит отключить учётную запись.</p>
        {error ? <p role="alert" className="error">{error}</p> : null}
        <button className="danger" type="submit" disabled={submitting}>Удалить</button>
      </form>
    </ModalDialog>
  );
}
```

После успешного DELETE сразу убрать dialog из DOM и затем refetch. Все row
actions используют существующий atomic `commandPendingRef`.

- [ ] **Step 5: Подтвердить GREEN component-тестов**

Run:

```bash
cd frontend
npm test -- --run src/features/admin/AdminUsersManager.test.tsx
```

Expected: все выбранные тесты проходят.

- [ ] **Step 6: Расширить Playwright fixture и browser flow**

Fixture:

- PATCH обновляет `username`;
- DELETE удаляет только synthetic unused user;
- DELETE для `runa` отвечает
  `409 USER_DELETE_BLOCKED`;
- request log не содержит пароли.

В `admin-users.spec.ts` после создания `Север`:

1. изменить `sever` на `sever-new`;
2. проверить обновлённую строку;
3. открыть delete dialog и удалить `Север`;
4. проверить отсутствие строки;
5. попытаться удалить использованную `Руна`;
6. проверить серверный текст отказа и сохранение строки.

Обновить ожидаемую последовательность запросов, включая DELETE и refetch.

- [ ] **Step 7: Запустить focused frontend/browser tests и commit**

Run:

```bash
cd frontend
npm test -- --run src/features/admin/AdminUsersManager.test.tsx
PLAYWRIGHT_PORT=5173 npx playwright test e2e/admin-users.spec.ts --workers=1
```

Expected: component и оба desktop browser projects проходят; BFCache skip,
если он есть в общем наборе, к этому flow не относится.

Commit:

```bash
git add frontend/src/features/admin/types.ts \
  frontend/src/features/admin/api.ts \
  frontend/src/features/admin/AdminUsersManager.tsx \
  frontend/src/features/admin/AdminUsersManager.test.tsx \
  frontend/e2e/fixtures/admin-users.ts \
  frontend/e2e/admin-users.spec.ts
git commit -m "feat(admin): edit logins and delete unused employees"
```

---

### Task 3: Единая версия `1.0.1`, changelog и компактный footer

**Files:**

- Create: `backend/tests/test_app_version.py`
- Modify: `backend/pyproject.toml`
- Modify: `backend/app/core/version.py`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/appVersion.ts`
- Create: `frontend/src/components/AppFooter.tsx`
- Create: `frontend/src/components/AppFooter.test.tsx`
- Modify: `frontend/src/components/app-shell/AppShell.tsx`
- Modify: `frontend/src/components/app-shell/AppShell.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles/layout.css`
- Replace: `CHANGELOG.md`
- Modify: `frontend/e2e/admin-users.spec.ts`

**Interfaces:**

- Produces: `FALLBACK_APP_VERSION = "1.0.1"`.
- Produces: build-time `__APP_VERSION__`.
- Produces: `APP_VERSION`.
- Produces: shared `<AppFooter />`.

- [ ] **Step 1: Написать RED version consistency test**

`backend/tests/test_app_version.py` читает файлы только stdlib:

```python
def test_application_version_is_consistent() -> None:
    pyproject = tomllib.loads((ROOT / "backend/pyproject.toml").read_text())
    package = json.loads((ROOT / "frontend/package.json").read_text())
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text())
    assert {
        pyproject["project"]["version"],
        FALLBACK_APP_VERSION,
        package["version"],
        lock["version"],
        lock["packages"][""]["version"],
    } == {"1.0.1"}
```

- [ ] **Step 2: Запустить consistency test и подтвердить RED**

Run:

```bash
cd backend
./.venv/bin/pytest -q tests/test_app_version.py
```

Expected: текущие metadata содержат `0.2.0`.

- [ ] **Step 3: Написать RED footer tests**

В `AppFooter.test.tsx` проверить один доступный текст и отсутствие интерактивных
элементов. В `AppShell.test.tsx` проверить footer после content.

В browser fixture проверить footer:

- до login / при password gate;
- внутри `.app-shell`;
- ровно один footer на странице.

- [ ] **Step 4: Запустить footer tests и подтвердить RED**

Run:

```bash
cd frontend
npm test -- --run src/components/AppFooter.test.tsx src/components/app-shell/AppShell.test.tsx
```

Expected: компонент отсутствует.

- [ ] **Step 5: Синхронизировать metadata и build-time version**

Установить `1.0.1` в backend/frontend metadata и lock root/package entry.
Экспортировать fallback:

```python
FALLBACK_APP_VERSION = "1.0.1"


def get_app_version() -> str:
    try:
        return version("newscast-navigator-backend")
    except PackageNotFoundError:
        return FALLBACK_APP_VERSION
```

В `vite.config.ts` прочитать `package.json` и определить:

```ts
define: {
  __APP_VERSION__: JSON.stringify(packageJson.version),
},
```

В `frontend/src/appVersion.ts`:

```ts
declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;
```

- [ ] **Step 6: Реализовать общий footer**

```tsx
export default function AppFooter() {
  return (
    <footer className="app-footer">
      Newscast Navigator v{APP_VERSION} · © 2026 Павел Курзыкин. Все права защищены.
    </footer>
  );
}
```

Подключить:

- в `AppShell` после `.app-shell-content`;
- в unauthenticated/password-change layout `App.tsx`;
- в обычном потоке, без `position: fixed|sticky`.

CSS должен быть компактным, muted и не менять ширину/overflow рабочих экранов.

- [ ] **Step 7: Перебазировать changelog на Product Reset**

Полностью заменить legacy/prototype историю:

```markdown
# Changelog

## [1.0.1] - 2026-07-30

### Added
- Безопасное удаление неиспользованных сотрудников.
- Компактный футер с версией приложения.

### Changed
- Начальник может изменить логин сотрудника.
- HTML ревалидируется после deploy, а content-hashed assets кешируются immutable.

## [1.0.0] - 2026-07-30

### Added
- Production baseline утверждённого Product Reset.
```

Git history остаётся архивом удалённого legacy.

- [ ] **Step 8: Подтвердить GREEN и commit release metadata**

Run:

```bash
cd backend
./.venv/bin/pytest -q tests/test_app_version.py
cd ../frontend
npm test -- --run src/components/AppFooter.test.tsx src/components/app-shell/AppShell.test.tsx
npm run build
```

Expected: consistency, footer tests и production build проходят.

Commit:

```bash
git add backend/pyproject.toml backend/app/core/version.py \
  backend/tests/test_app_version.py \
  frontend/package.json frontend/package-lock.json frontend/vite.config.ts \
  frontend/src/appVersion.ts frontend/src/components/AppFooter.tsx \
  frontend/src/components/AppFooter.test.tsx \
  frontend/src/components/app-shell/AppShell.tsx \
  frontend/src/components/app-shell/AppShell.test.tsx \
  frontend/src/App.tsx frontend/src/styles/layout.css \
  frontend/e2e/admin-users.spec.ts CHANGELOG.md
git commit -m "chore(release): establish version 1.0.1"
```

---

### Task 4: Browser cache policy и smoke contract

**Files:**

- Modify: `backend/tests/test_operations_contract.py`
- Modify: `frontend/nginx.prod.conf`
- Modify: `deploy/scripts/smoke.sh`

**Interfaces:**

- HTML: `Cache-Control: no-cache, must-revalidate`.
- Hashed `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`.
- Missing `/assets/*`: `404`, никогда не SPA HTML.
- Smoke output additionally confirms `html_cache`, `asset_cache`,
  `missing_asset`.

- [ ] **Step 1: Написать RED operations contract tests**

Проверить parsed/source contract:

```python
def test_frontend_nginx_revalidates_html_and_immutably_caches_assets() -> None:
    config = (REPO_ROOT / "frontend/nginx.prod.conf").read_text()
    assert 'location = /index.html' in config
    assert 'Cache-Control "no-cache, must-revalidate"' in config
    assert "location /assets/" in config
    assert 'Cache-Control "public, max-age=31536000, immutable"' in config
    assert "try_files $uri =404;" in config
```

Расширить fake smoke/curl contract так, чтобы отсутствие любой из трёх
проверок делало smoke красным.

- [ ] **Step 2: Запустить operations tests и подтвердить RED**

Run:

```bash
cd backend
./.venv/bin/pytest -q tests/test_operations_contract.py -k "nginx or smoke"
```

Expected: текущий nginx не задаёт cache headers, smoke их не проверяет.

- [ ] **Step 3: Реализовать nginx policy**

```nginx
location = /index.html {
    add_header Cache-Control "no-cache, must-revalidate" always;
}

location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    try_files $uri =404;
}

location / {
    add_header Cache-Control "no-cache, must-revalidate" always;
    try_files $uri $uri/ /index.html;
}
```

Сохранить `/healthz` без изменения.

- [ ] **Step 4: Расширить canonical smoke**

`deploy/scripts/smoke.sh` должен:

1. сохранить headers корня;
2. проверить root cache-control;
3. извлечь первый `/assets/*.js` из HTML;
4. запросить asset и проверить immutable header;
5. запросить уникальный отсутствующий asset и проверить exact `404`;
6. сохранить прежние health/auth checks.

Ни один cache check не должен печатать cookie или credentials.

- [ ] **Step 5: Подтвердить GREEN и runtime behavior**

Run:

```bash
cd backend
./.venv/bin/pytest -q tests/test_operations_contract.py
cd ..
docker compose -f compose.yaml config
docker compose -f deploy/compose.demo.yaml \
  --env-file deploy/env/demo.env.example config
```

После production image build:

```bash
DEMO_PORT="$(
  docker compose --project-name newscast_navigator_demo \
    --env-file deploy/env/demo.env \
    -f deploy/compose.demo.yaml \
    port gateway 80 |
    awk -F: 'NR == 1 {print $NF}'
)"
DEMO_URL="http://127.0.0.1:${DEMO_PORT}"
HASHED_ASSET="$(
  curl -sS "${DEMO_URL}/" |
    sed -n 's/.*src="\([^"]*\/assets\/[^"]*\.js\)".*/\1/p' |
    head -n 1
)"
curl -sSI "${DEMO_URL}/"
curl -sSI "${DEMO_URL}${HASHED_ASSET}"
curl -sSI "${DEMO_URL}/assets/missing-v1.0.1.js"
```

Expected: `no-cache`, `immutable`, `404`.

- [ ] **Step 6: Commit cache checkpoint**

```bash
git add frontend/nginx.prod.conf deploy/scripts/smoke.sh \
  backend/tests/test_operations_contract.py
git commit -m "fix(frontend): revalidate html after deploy"
```

---

### Task 5: Полная локальная проверка, browser QA, docs и review

**Files:**

- Modify: `docs/product-reset/PROGRESS.md`
- Modify only if an actual risk changes:
  `docs/product-reset/RISK_REGISTER_RU.md`

- [ ] **Step 1: Запустить focused backend/frontend matrix**

```bash
cd backend
./.venv/bin/pytest -q tests/test_admin.py tests/test_auth.py \
  tests/test_app_version.py tests/test_operations_contract.py
cd ../frontend
npm test -- --run src/features/admin/AdminUsersManager.test.tsx \
  src/components/AppFooter.test.tsx \
  src/components/app-shell/AppShell.test.tsx
npm run build
PLAYWRIGHT_PORT=5173 npx playwright test e2e/admin-users.spec.ts \
  e2e/accessibility.spec.ts --workers=1
```

- [ ] **Step 2: Запустить полный доступный набор**

```bash
cd backend
./.venv/bin/pytest -q
cd ../frontend
npm test -- --run
npm run build
PLAYWRIGHT_PORT=5173 npx playwright test --workers=1
cd ..
docker compose -f compose.yaml config
docker compose -f compose.test.yaml config
docker compose -f deploy/compose.demo.yaml \
  --env-file deploy/env/demo.env.example config
```

Все failures исследовать; не объявлять зелёным flaky parallel run.

- [ ] **Step 3: Выполнить clean-deploy rehearsal**

Использовать канонический synthetic runner и его exact CLI из
`EVAL_COMMANDS.json`. Проверить:

- чистую PostgreSQL;
- migration head без новой миграции;
- synthetic seed;
- health и authenticated smoke;
- новые cache headers;
- backup/restore;
- отсутствие leftover containers/volumes.

- [ ] **Step 4: Проверить фактический UI**

В чистом browser context и в context с предыдущим посещением:

- login/footer;
- `/admin` на `1366x768` и `1920x1080`;
- rename login;
- delete unused;
- blocked delete used;
- отсутствие horizontal overflow;
- server error видим и понятен;
- footer не перекрывает content;
- после hard reload загружается `1.0.1`;
- console errors/warnings отсутствуют.

- [ ] **Step 5: Запустить local final evaluator fail-closed**

```bash
cd backend
./.venv/bin/python scripts/product_reset_eval.py verify \
  --scope final \
  --repo-root ..
```

До нового production evidence допустим только ожидаемый отказ по старому
`DEPLOYMENT_BINDING_COMMIT`/external exact SHA. Любой другой gate — blocker.

- [ ] **Step 6: CodeRabbit и self-review**

Запустить CodeRabbit review всего диапазона:

```bash
coderabbit review --base main --plain
```

Каждое замечание проверить по коду и тестам. Valid finding исправить через
новый RED→GREEN commit; неверное — документированно отклонить. Повторять до
отсутствия открытых actionable findings.

- [ ] **Step 7: Обновить progress и commit**

Записать exact commit SHA, команды, counts, browser evidence, CodeRabbit и
остаточные риски в `docs/product-reset/PROGRESS.md`.

```bash
git add docs/product-reset/PROGRESS.md \
  docs/product-reset/RISK_REGISTER_RU.md
git commit -m "docs: record v1.0.1 local verification"
```

Проверить:

```bash
git diff --check main...HEAD
git status --short
```

Expected: чистый worktree.

---

### Task 6: PR, merge, tags и точечный production deploy

**Prerequisite:** Task 5 green; от evaluator остался только ожидаемый stale
external/deployment binding.

- [ ] **Step 1: Push и ready PR**

```bash
git push -u origin codex/v1.0.1-user-management
gh pr create \
  --base main \
  --head codex/v1.0.1-user-management \
  --title "Newscast Navigator 1.0.1" \
  --body $'## Что изменено\n- редактирование логина сотрудника\n- безопасное удаление неиспользованной учётной записи\n- единая версия 1.0.1 и компактный футер\n- cache policy для HTML и hashed assets\n\n## Проверки\n- backend, frontend, production build и Playwright\n- clean deploy rehearsal и CodeRabbit\n\n## Deploy\nМиграции нет; заменить только backend/frontend. Rollback — предыдущие image IDs.'
```

PR body перечисляет behavior, tests, no-migration deploy и rollback. Не
вставлять secrets или memory citations.

- [ ] **Step 2: Дождаться CI и PR review**

```bash
PR_NUMBER="$(
  gh pr view codex/v1.0.1-user-management --json number --jq .number
)"
gh pr checks "${PR_NUMBER}" --watch
gh pr view "${PR_NUMBER}" --comments
```

Исправлять только подтверждённые замечания отдельными commits с повторной
локальной матрицей. Merge только при green required checks и отсутствии
actionable review findings.

- [ ] **Step 3: Merge без squash и зафиксировать exact runtime SHA**

```bash
gh pr merge "${PR_NUMBER}" --merge --delete-branch=false
git fetch origin main --tags
git rev-parse origin/main
```

Merge commit становится `V1_0_1_RUNTIME_SHA`. Проверить, что все commits патча
являются его предками.

- [ ] **Step 4: Создать baseline tag**

```bash
git tag -a v1.0.0 33828d81e8489cdadcec2683f4c98a11d27538db \
  -m "Newscast Navigator 1.0.0"
git push origin v1.0.0
```

Если tag уже существует, сначала проверить exact SHA; несовпадение — blocker,
tag не перемещать.

- [ ] **Step 5: Production preflight и backup**

Через `ssh newscast-home`:

- проверить current checkout/runtime SHA и health;
- проверить свободное место;
- определить уже используемый защищённый `deploy/env/demo.env`, не печатая его
  содержимое;
- сохранить текущий admin password hash только как in-process comparison
  value, не выводить его;
- выполнить канонический `backup_db.sh`;
- проверить checksum и `pg_restore --list`;
- записать rollback SHA и текущие image IDs.

Любой неуспешный backup/health/hash preflight останавливает deploy.

- [ ] **Step 6: Доставить exact merge SHA и собрать только app images**

В `/home/newscast/newscast-product-reset-demo`:

```bash
git fetch --prune origin main
git checkout --detach "${V1_0_1_RUNTIME_SHA}"
test "$(git rev-parse HEAD)" = "${V1_0_1_RUNTIME_SHA}"
docker compose --project-name newscast_navigator_demo \
  --env-file deploy/env/demo.env \
  -f deploy/compose.demo.yaml \
  build backend frontend
```

Старые containers продолжают обслуживать трафик во время build.

- [ ] **Step 7: Заменить только backend/frontend**

```bash
docker compose --project-name newscast_navigator_demo \
  --env-file deploy/env/demo.env \
  -f deploy/compose.demo.yaml \
  up -d --no-deps backend
docker compose --project-name newscast_navigator_demo \
  --env-file deploy/env/demo.env \
  -f deploy/compose.demo.yaml \
  up -d --no-deps frontend
```

Сравнить до/после:

- `db` container ID не изменился;
- `gateway` container ID не изменился;
- migration head не изменился;
- admin password hash совпадает exact, но сам hash не печатается;
- admin активен, `must_change_password=false`, имеет ровно `chief`.

- [ ] **Step 8: Smoke, browser и rollback decision**

Запустить:

- canonical authenticated `deploy/scripts/smoke.sh`;
- public `/api/health`, unauthenticated `/auth/me`;
- admin login, `/stories`, `/admin/users`;
- CaptionPanels list/import smoke;
- HTML/asset/missing-asset cache checks;
- browser `1366x768` и `1920x1080` с clean и previously-used profile;
- footer `v1.0.1`, rename/delete behavior, console 0.

При failure вернуть предыдущие backend/frontend image IDs и повторить smoke.
DB restore не выполнять без признака изменения данных.

- [ ] **Step 9: Создать release tag только после успешного smoke**

```bash
git tag -a v1.0.1 "${V1_0_1_RUNTIME_SHA}" \
  -m "Newscast Navigator 1.0.1"
git push origin v1.0.1
```

Проверить local/remote tag exact SHA.

---

### Task 7: Exact-SHA production evidence и финальный evaluator

**Files:**

- Modify: `backend/app/services/product_reset_eval.py`
- Modify: `backend/tests/test_product_reset_eval.py`
- Modify as required by exact evidence schema:
  `backend/tests/test_demo_evidence.py`
- Modify as required by exact UX evidence schema:
  `backend/tests/test_ux_eval_evidence.py`
- Modify: `docs/product-reset/DEMO_EVIDENCE.json`
- Modify: `docs/product-reset/EVAL_RESULT.json`
- Modify: `docs/product-reset/UX_EVAL_RU.md`
- Modify: `docs/product-reset/RISK_REGISTER_RU.md`
- Modify: `docs/product-reset/PROGRESS.md`

- [ ] **Step 1: Создать evidence branch от нового main**

```bash
git fetch origin main
git switch -c codex/v1.0.1-evidence origin/main
```

- [ ] **Step 2: Написать RED exact-binding tests**

Обновить tests так, чтобы:

- `DEMO_APPROVED_APP_SHA == V1_0_1_RUNTIME_SHA`;
- `DEPLOYMENT_BINDING_COMMIT == V1_0_1_RUNTIME_SHA`;
- ancestry:
  `CP7 evaluated -> CP7 binding -> V1_0_1_RUNTIME_SHA -> evidence HEAD`;
- любые runtime paths после нового deployment SHA запрещены;
- разрешены только существующие evidence/evaluator paths;
- tag `v1.0.1` указывает на exact runtime SHA.

До изменения constants tests должны падать на старом
`1c7ef1be0f301272e8d3daa116bb471f1fc2ccc0`.

- [ ] **Step 3: Обновить structured evidence**

Внести только фактически полученные production данные:

- runtime/tag SHA;
- timestamp и публичный URL;
- health/auth/CaptionPanels/cache smoke outcomes;
- viewport/browser checks;
- неизменность db/gateway/admin hash как boolean evidence без secrets;
- rollback readiness;
- counts/hashes обязательных untracked artifacts.

Не переиспользовать старый external SHA как новый результат.

- [ ] **Step 4: Запустить evidence tests и verify**

```bash
cd backend
./.venv/bin/pytest -q tests/test_demo_evidence.py \
  tests/test_product_reset_eval.py \
  tests/test_ux_eval_evidence.py
./.venv/bin/python scripts/product_reset_eval.py verify \
  --scope final \
  --repo-root ..
```

Expected:

```json
{"passed": true, "errors": []}
```

- [ ] **Step 5: Evidence-only commit, PR и merge**

```bash
git add backend/app/services/product_reset_eval.py \
  backend/tests/test_product_reset_eval.py \
  backend/tests/test_demo_evidence.py \
  backend/tests/test_ux_eval_evidence.py \
  docs/product-reset/DEMO_EVIDENCE.json \
  docs/product-reset/EVAL_RESULT.json \
  docs/product-reset/UX_EVAL_RU.md \
  docs/product-reset/RISK_REGISTER_RU.md \
  docs/product-reset/PROGRESS.md
git commit -m "docs(eval): bind v1.0.1 production evidence"
git push -u origin codex/v1.0.1-evidence
```

Открыть ready evidence PR, дождаться CI/review, merge обычным merge.
Production повторно не deploy: evidence commit не меняет runtime.

- [ ] **Step 6: Финальная независимая проверка**

В fresh full-history clone exact нового `origin/main`:

```bash
cd backend
./.venv/bin/python scripts/product_reset_eval.py verify \
  --scope final \
  --repo-root ..
```

Проверить:

- final evaluator green;
- `v1.0.0` exact baseline;
- `v1.0.1` exact deployed runtime SHA;
- public footer `v1.0.1`;
- production health green;
- рабочая ветка и source `main` не содержат незакоммиченных изменений.

---

## Stop Conditions

Остановиться и запросить решение только если:

- tag `v1.0.0` или `v1.0.1` уже существует и указывает на другой SHA;
- удаление неиспользованного пользователя требует изменения утверждённой
  продуктовой модели или потери исторических данных;
- production admin hash невозможно сохранить/сравнить без раскрытия секрета;
- backup/restore validation не проходит;
- миграция неожиданно требуется;
- green tests требуют пересоздания production DB/gateway;
- новый final evaluator невозможно сделать exact-SHA без ослабления
  fail-closed правил.

Обычные технические расхождения решать в рамках
`V1_0_1_USER_MANAGEMENT_AND_RELEASE_DESIGN_RU.md` и `SPEC_RU.md`.
