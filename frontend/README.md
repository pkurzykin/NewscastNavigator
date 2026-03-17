# Frontend

React + TypeScript + Vite frontend для новой web-версии `Newscast Navigator`.

## Локальный запуск

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

По умолчанию UI работает на `http://127.0.0.1:5173`.

Для ежедневной локальной работы на этом Mac используй `bash deploy/scripts/dev_native_frontend.sh` и общий workflow из `docs/LOCAL_DEV_WORKFLOW_RU.md`.

## Переменные окружения

- `VITE_API_BASE_URL=http://127.0.0.1:8100` — прямой вызов backend API
- `VITE_PROXY_TARGET=http://127.0.0.1:8100` — backend для dev-proxy
- `VITE_DEV_HOST=127.0.0.1`
- `VITE_DEV_PORT=5173`

Если frontend запускается через dev-proxy в Docker, значение может быть пустым.
