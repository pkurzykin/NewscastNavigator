# Brand Guidelines: Транснефть (для Newscast Navigator)

Дата актуализации: 2026-04-22

## Источник
- Внешний брендбук: `/Volumes/work/Projects/Transneft-Guide/Transneft-Guide-11.28-RU_fin.pdf`
- Исходные логотипы: `/Volumes/work/Projects/Transneft-Guide/logo/`
- Эта папка остается вне git-репозитория.

## Канонические токены UI
- `brand blue primary`: `#00447C` (RGB `0,68,124`)
- `brand blue accent`: `#005596` (RGB `0,85,150`)
- `brand red accent`: `#EE3124` (RGB `238,49,36`)
- `surface`: `#FFFFFF`
- `background`: `#F3F6FA`

## Типографика
- Заголовки и интерфейсные акценты: Franklin Gothic stack
- Основной текст интерфейса: PT Sans stack
- Реализация зафиксирована в `frontend/src/styles.css` через переменные:
  - `--brand-font-heading`
  - `--brand-font-body`

## Логотип в приложении
- Рабочий logo-asset в репозитории: `frontend/public/branding/transneft-logo.png`
- Конфиг ссылки: `frontend/src/shared/brand.ts` (`logoPath`)
- Использование в шапке: `frontend/src/App.tsx`

## Обязательные правила на будущее
- Любые новые UI-экраны используют эти же токены и шрифтовые стеки.
- Новые бренд-ассеты сначала берутся из внешнего `Transneft-Guide`, затем копируются как производные в `frontend/public/branding/`.
- Запрещено добавлять в git исходную папку `Transneft-Guide` и служебные `._*` файлы.
