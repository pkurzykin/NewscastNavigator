# Web smoke checklist

## Автоматический smoke

```bash
./deploy/scripts/smoke.sh --compose-file deploy/compose.demo.yaml
```

Ожидается health `200`, root `200`, unauthenticated auth `401`. Для
authenticated шага передаются `SMOKE_USERNAME` и `SMOKE_PASSWORD` только через
окружение; значения не печатаются.

## Фактический интерфейс

- на `/stories` видны общий компактный список и, только при наличии действий,
  блок «Требует внимания»;
- таблица имеет шесть колонок и минимум шесть строк на `1366×768`;
- поиск работает по названию, автору и рубрике;
- карточка содержит ровно «Сценарий», «Производство», «История»;
- URL `/stories/:id/scenario` сохраняет сюжет и вкладку после refresh;
- видимо одно главное действие;
- completed production stages находятся в compact summary;
- клавиатурный focus видим, critical/serious axe findings отсутствуют.

## Workflow

- создать сюжет с названием, рубрикой и автором;
- изменить актуальный сценарий и убедиться, что тихий autosave не меняет focus,
  selection или scroll;
- отправить на проверку, подтвердить редакционное решение, отметить proofread;
- назначить production owners, добавить material link;
- выполнить voiceover/video/titles gates;
- создать единый correction package и закрыть items;
- провести repeatable external approval cycle;
- отметить эфир, архивировать и восстановить;
- проверить meaningful history и session diff.

## CaptionPanels

- story list доступен только после auth;
- import JSON содержит latest current scenario и stable identifiers;
- поздняя правка создаёт notification/diff и не обновляет After Effects
  автоматически.

## Stop factors

- пропадает локальный текст;
- устаревший save response перезаписывает ввод;
- server разрешает запрещённый action;
- CaptionPanels отдаёт неактуальный сценарий;
- default credentials принимаются;
- backup checksum/restore/smoke не проходят;
- в dataset/evidence обнаружены секреты, контакты или реальные пути.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
