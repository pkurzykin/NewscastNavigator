# Frontend

React, TypeScript, Vite и TipTap. Общий запуск и проверка — в
[локальной разработке](../docs/engineering/LOCAL_DEV_WORKFLOW_RU.md),
оформление — в [дизайн-системе](../docs/engineering/UI_SYSTEM_RU.md).

## Запуск отдельно от Compose

Из корня репозитория:

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev
```

По умолчанию интерфейс работает на `http://127.0.0.1:5173` и требует доступного
backend. Используйте собственную изолированную среду и синтетические данные.

## Настройки разработки

- `VITE_API_BASE_URL=http://127.0.0.1:8100` — прямой backend API;
- `VITE_PROXY_TARGET=http://127.0.0.1:8100` — backend для dev proxy;
- `VITE_DEV_HOST=127.0.0.1`;
- `VITE_DEV_PORT=5173`.

Для dev proxy можно оставить API base пустым. При ошибке запроса сначала
проверьте адрес backend и его `/api/health`; не изменяйте production-настройки
для исправления локального запуска. Установка зависимостей использует
зафиксированный package-lock через `npm ci`.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
