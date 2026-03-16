# Frontend

React + TypeScript + Vite frontend для новой web-версии `Newscast Navigator`.

## Локальный запуск

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

По умолчанию UI работает на `http://localhost:5173`.

Для ежедневной локальной работы на этом Mac используй `bash deploy/scripts/dev_native_frontend.sh` и общий workflow из `docs/LOCAL_DEV_WORKFLOW_RU.md`.

## Переменные окружения

- `VITE_API_BASE_URL=http://localhost:8100` — прямой вызов backend API

Если frontend запускается через dev-proxy в Docker, значение может быть пустым.
