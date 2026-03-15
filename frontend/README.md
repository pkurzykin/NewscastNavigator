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

## Переменные окружения

- `VITE_API_BASE_URL=http://localhost:8100` — прямой вызов backend API

Если frontend запускается через dev-proxy в Docker, значение может быть пустым.
