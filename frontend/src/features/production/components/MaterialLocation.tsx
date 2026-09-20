import Button from "@mui/material/Button";
import { useEffect, useRef, useState } from "react";
import { describeMaterialLocation } from "../materialLocation";

// Older intranet HTTP pages may not expose navigator.clipboard. Keep a
// user-initiated fallback and never report success unless copying succeeded.
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // A denied Clipboard API request can still permit the browser copy command.
  }
  const previous = document.activeElement;
  const temporary = document.createElement("textarea");
  temporary.value = value;
  temporary.readOnly = true;
  temporary.tabIndex = -1;
  temporary.style.position = "fixed";
  temporary.style.opacity = "0";
  temporary.style.pointerEvents = "none";
  document.body.appendChild(temporary);
  try {
    temporary.focus({ preventScroll: true });
    temporary.select();
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    temporary.remove();
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
  }
}

export default function MaterialLocation({ location }: { location: string }) {
  const details = describeMaterialLocation(location);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualValue, setManualValue] = useState<string | null>(null);
  const inFlight = useRef(false);
  const manualField = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (manualValue !== null) {
      manualField.current?.focus({ preventScroll: true });
      manualField.current?.select();
    }
  }, [manualValue]);

  async function copy(value: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setCopied(false);
    setManualValue(null);
    const success = await copyText(value);
    inFlight.current = false;
    setPending(false);
    setCopied(success);
    if (!success) setManualValue(value);
  }

  return <>
    {details.href ? (
      <a className="production-material-location-value" href={details.href} target="_blank" rel="noopener noreferrer">{details.display}</a>
    ) : <span className="production-material-location-value">{details.display}</span>}
    <div className="production-material-copy-actions">
      {details.copies.length > 1 ? <span>Скопировать:</span> : null}
      {details.copies.map((option) => (
        <Button key={option.label} size="small" disabled={pending}
          aria-label={option.label === "Для Windows" ? "Копировать путь для Windows" : option.label === "Для Linux" ? "Копировать путь для Linux" : option.label}
          onClick={() => { void copy(option.value); }}>
          {option.label}
        </Button>
      ))}
    </div>
    {copied ? <span className="production-material-copy-feedback" role="status">{details.href ? "Ссылка скопирована" : "Путь скопирован"}</span> : null}
    {manualValue !== null ? <div className="production-material-copy-fallback">
      <p role="alert">Не удалось скопировать автоматически. Нажмите Ctrl+C (⌘C на Mac).</p>
      <textarea ref={manualField} aria-label="Путь для ручного копирования" readOnly value={manualValue} rows={2} />
    </div> : null}
  </>;
}
