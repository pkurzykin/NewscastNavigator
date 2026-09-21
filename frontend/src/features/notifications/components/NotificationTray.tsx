import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Badge from "@mui/material/Badge";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Tooltip from "@mui/material/Tooltip";
import { buildSemanticScenarioDiff, type SemanticFieldDiff, type SemanticValue } from "../../history/semanticScenarioDiff";
import type { ScenarioFontContext, ScenarioRowDiff } from "../../history/types";

import {
  fetchNotifications,
  NOTIFICATIONS_INVALIDATED_EVENT,
  readNotification,
} from "../api";
import type { InternalNotification, NotificationDiffChange } from "../types";
import { useSerializedRefresh } from "../useSerializedRefresh";


function changeLabel(change: NotificationDiffChange): string {
  if (change.kind === "added") return "Добавлен блок";
  if (change.kind === "removed") return "Удалён блок";
  if (change.kind === "moved") return "Блок перемещён";
  return "Блок изменён";
}

function formatNotificationDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow",
  }).format(date);
}

function unreadLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  const word = lastTwo !== 11 && last === 1 ? "непрочитанное" : "непрочитанных";
  return `${count} ${word}`;
}

function NotificationMeta({ item }: { item: InternalNotification }) {
  const at = formatNotificationDateTime(item.created_at);
  if (!item.actor && !at) return null;
  return <small className="notification-meta">
    {item.actor?.display_name}{item.actor && at ? " · " : ""}
    {at ? <time dateTime={item.created_at}>{at}</time> : null}
  </small>;
}

function formatDescription(value: SemanticValue | null): string {
  const formats = value?.runs?.length ? value.runs.map((run) => run.formatting) : [value?.formatting];
  return [...new Set(formats.map((format) => [
    format?.font_family || "Основной шрифт",
    format?.bold ? "полужирный" : "обычный",
    format?.italic ? "курсив" : "",
    format?.strikethrough ? "зачёркнутый" : "",
    format?.fill_color && format.fill_color !== "#ffffff" ? "цветная заливка" : "",
  ].filter(Boolean).join(" · ")))].join("; ");
}

function DiffField({ field }: { field: SemanticFieldDiff }) {
  const formattingOnly = Boolean(field.before && field.after && field.before.text === field.after.text);
  const beforeFormat = formattingOnly ? formatDescription(field.before) : "";
  const afterFormat = formattingOnly ? formatDescription(field.after) : "";
  return <div className="notification-diff-field">
    <span className="notification-diff-field-label">{field.label}</span>
    {formattingOnly ? <>
      <span className="notification-diff-format">Изменено оформление</span>
      <span>{field.before?.text}</span>
      {beforeFormat === afterFormat ? (
        <span className="notification-diff-format-detail">Изменилось оформление фрагментов текста. Подробное сравнение — в истории.</span>
      ) : <>
        <span className="notification-diff-format-detail">Было: {beforeFormat}</span>
        <span className="notification-diff-format-detail">Стало: {afterFormat}</span>
      </>}
    </> : <>
      {field.before ? <del className="notification-diff-before"><span aria-hidden="true">− </span><span>{field.before.text}</span></del> : null}
      {field.after ? <ins className="notification-diff-after"><span aria-hidden="true">+ </span><span>{field.after.text}</span></ins> : null}
    </>}
  </div>;
}

function DiffChange({ change, fontContext }: {
  change: NotificationDiffChange;
  fontContext: ScenarioFontContext | undefined;
}) {
  const semantic = buildSemanticScenarioDiff([{
    ...change,
    before: change.before ?? null,
    after: change.after ?? null,
    moved: change.moved ?? change.kind === "moved",
    changed_fields: change.changed_fields ?? [],
  } as ScenarioRowDiff], fontContext)[0];
  const contentFields = semantic?.fields.filter((field) => field.key !== "block_type") ?? [];
  const emptyBlock = (change.kind === "added" || change.kind === "removed") && contentFields.length === 0;
  const blockType = semantic?.fields.find((field) => field.key === "block_type");
  const typeName = (change.kind === "removed" ? blockType?.before : blockType?.after)?.text;
  const position = change.after?.order_index ?? change.before?.order_index;
  const heading = emptyBlock
    ? `${change.kind === "removed" ? "Удалён" : "Добавлен"} пустой блок${typeName ? ` ${typeName}` : ""}`
    : changeLabel(change);
  const fields = change.kind === "added" || change.kind === "removed" ? contentFields : semantic?.fields ?? [];

  return <li className={`notification-diff-change notification-diff-change-${change.kind}`}>
    <strong>{heading}{typeof position === "number" ? ` · строка ${position}` : ""}</strong>
    {change.moved ? <span>Строка: {String(change.before?.order_index ?? "?")} → {String(change.after?.order_index ?? "?")}</span> : null}
    {fields.map((field) => <DiffField key={field.key} field={field} />)}
    {!fields.length && !emptyBlock && !change.moved ? <span>Изменены свойства блока. Полное сравнение доступно в истории.</span> : null}
  </li>;
}

function NotificationDiff({ item }: { item: InternalNotification }) {
  const [expanded, setExpanded] = useState(false);
  const diff = item.diff;
  const fontChanged = Boolean(diff?.default_font_family
    && diff.default_font_family.before !== diff.default_font_family.after);
  return (
    <div className="notification-diff">
      <div className="notification-actions">
        <a href={item.target_href}>Открыть сюжет</a>
        {diff ? <Button type="button" variant="text" className="notification-diff-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Свернуть" : "Показать изменения"}
        </Button> : null}
      </div>
      {expanded && diff ? <div className="notification-diff-content">
      <p className="notification-diff-meta">
        Изменений: {diff.summary.total}
      </p>
      {fontChanged ? <p className="notification-diff-font">
        Изменён основной шрифт сценария: {diff.default_font_family!.before} → {diff.default_font_family!.after}
      </p> : null}
      <ul>
        {diff.changes.map((change) => (
          <DiffChange key={`${change.segment_uid}:${change.kind}`} change={change} fontContext={diff.default_font_family} />
        ))}
      </ul>
      {diff.href ? <a href={diff.href}>Показать изменения в истории</a> : null}
      </div> : null}
    </div>
  );
}

export default function NotificationTray() {
  const [items, setItems] = useState<InternalNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [readError, setReadError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (generation: number) => {
    try {
      const response = await fetchNotifications();
      if (!mountedRef.current || generation !== generationRef.current) return;
      setItems(response.items);
      setUnreadCount(response.unread_count);
      setLoaded(true);
      setLoadError(false);
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return;
      setLoadError(true);
      setLoaded(true);
    }
  }, []);
  const { refreshNow, supersede: supersedeRefresh } = useSerializedRefresh(load);

  useEffect(() => {
    mountedRef.current = true;
    refreshNow();
    window.addEventListener(NOTIFICATIONS_INVALIDATED_EVENT, refreshNow);
    return () => {
      mountedRef.current = false;
      window.removeEventListener(NOTIFICATIONS_INVALIDATED_EVENT, refreshNow);
    };
  }, [refreshNow]);

  useEffect(() => {
    if (!open) return;
    // This tray is a non-modal popover: keep the app shell available to assistive
    // technology while MUI owns positioning and focusable surface semantics.
    wrapRef.current?.closest<HTMLElement>('[aria-hidden="true"]')?.removeAttribute("aria-hidden");
    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || paperRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      requestAnimationFrame(() => toggleRef.current?.focus());
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const markRead = async (notificationId: number) => {
    if (pendingId !== null) return;
    setReadError(false);
    setPendingId(notificationId);
    try {
      await readNotification(notificationId);
      generationRef.current += 1;
      supersedeRefresh();
      if (!mountedRef.current) return;
      setItems((current) => current.filter((item) => item.id !== notificationId));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch {
      if (mountedRef.current) setReadError(true);
    } finally {
      if (mountedRef.current) setPendingId(null);
    }
  };

  return (
    <div ref={wrapRef} className="notification-tray-wrap">
      <Button
        ref={toggleRef}
        type="button"
        variant="text"
        className="notification-tray-toggle"
        aria-label={`Уведомления, непрочитанных: ${unreadCount}`}
        aria-expanded={open}
        aria-controls={open ? "notification-tray" : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Badge badgeContent={unreadCount} color="error" invisible={unreadCount === 0}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M5 8a5 5 0 0 1 10 0v4l2 2H3l2-2V8ZM8 17h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </Badge>
        <span className="notification-tray-label">Уведомления</span>
      </Button>
      <Popover
        open={open}
        anchorEl={toggleRef.current}
        onClose={(_event, reason) => {
          setOpen(false);
          if (reason === "escapeKeyDown") {
            requestAnimationFrame(() => toggleRef.current?.focus());
          }
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        hideBackdrop
        disableScrollLock
        disableAutoFocus
        disableEnforceFocus
        disableRestoreFocus
        className="notification-tray-popover"
        slotProps={{
          paper: {
            ref: paperRef,
            id: "notification-tray",
            className: "notification-tray",
            role: "region",
            "aria-label": "Уведомления",
          },
        }}
      >
          <header>
            <h2>Уведомления</h2>
            <span className="notification-header-count">{unreadLabel(unreadCount)}</span>
            <IconButton type="button" className="notification-close" aria-label="Закрыть уведомления" onClick={() => { setOpen(false); toggleRef.current?.focus(); }}>
              <span aria-hidden="true">×</span>
            </IconButton>
          </header>
          {readError ? (
            <Alert className="notification-error" severity="error">
              Не удалось отметить уведомление прочитанным. Попробуйте ещё раз.
            </Alert>
          ) : null}
          {!loaded ? <p className="notification-state" role="status">Загружаем уведомления…</p> : null}
          {loadError ? <Alert className="notification-load-error" severity="error" action={(
            <Button type="button" color="inherit" onClick={refreshNow}>Повторить</Button>
          )}>
            Не удалось загрузить уведомления. Проверьте соединение и попробуйте ещё раз.
          </Alert> : null}
          {loaded && !loadError && items.length === 0 ? <p className="notification-state">Новых уведомлений нет</p> : null}
          <ul className="notification-list">
            {items.map((item) => (
              <li key={item.id} className="notification-item">
                <span className="notification-unread-dot" aria-hidden="true" />
                <div className="notification-item-main">
                  <strong>{item.title}</strong>
                  <span className="notification-story">{item.story.title}</span>
                  <NotificationMeta item={item} />
                  {item.summary ? <p className="notification-summary">{item.summary}</p> : null}
                <NotificationDiff item={item} />
                </div>
                <Tooltip title="Отметить прочитанным" arrow>
                  <span>
                    <IconButton type="button" className="notification-mark-read" aria-label="Отметить прочитанным" disabled={pendingId !== null} onClick={() => { void markRead(item.id); }}>
                      <span aria-hidden="true">✓</span>
                    </IconButton>
                  </span>
                </Tooltip>
              </li>
            ))}
          </ul>
      </Popover>
    </div>
  );
}
