import { createElement, forwardRef, useEffect, useRef, useState, type ChangeEvent, type ComponentPropsWithoutRef, type FocusEvent, type KeyboardEvent } from "react";
import { useFieldEditAccess } from "./ScenarioAccessContext";

type NativeElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type NativeProps = {
 value?: string | number | readonly string[];
 disabled?: boolean;
 onChange?: (event: ChangeEvent<NativeElement>) => void;
 onFocus?: (event: FocusEvent<NativeElement>) => void;
 onBlur?: (event: FocusEvent<NativeElement>) => void;
 onKeyDown?: (event: KeyboardEvent<NativeElement>) => void;
};
function nativeField<Tag extends "input" | "textarea" | "select", Element extends NativeElement>(tag: Tag) {
 return forwardRef<Element, ComponentPropsWithoutRef<Tag>>(function AccessNativeField(props, forwarded) {
  const original = props as NativeProps;
  const access = useFieldEditAccess();
  const live = useRef({ access, original }); live.current = { access, original };
  const element = useRef<Element | null>(null);
  const candidate = useRef<{ value: string; base: NativeProps["value"]; start: number | null; end: number | null } | null>(null);
  const [candidateValue, setCandidateValue] = useState<string | null>(null);
  const [error, setError] = useState("");
  const composing = useRef(false);
  const granted = useRef(false);
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; live.current.access?.deactivateCandidate?.(candidateId()); }; }, []);
  const candidateId = () => `${element.current?.closest("tr")?.getAttribute("data-segment-uid") ?? "metadata"}:${element.current?.getAttribute("aria-label") ?? tag}`;
  const finish = () => {
   const next = candidate.current;
   if (!active.current || !next || !granted.current || composing.current) return;
   if (!live.current.access?.canMutate() || live.current.original.value !== next.base) {
    setError("Локальный ввод сохранён отдельно; значение на сервере изменилось."); return;
   }
   // Capture only the value/selection, never retain an event or an outdated row callback.
   const target = { value: next.value, selectionStart: next.start, selectionEnd: next.end } as Element;
   live.current.original.onChange?.({ target, currentTarget: target } as ChangeEvent<Element>);
   live.current.access?.storeCandidate?.(candidateId(), null);
   candidate.current = null; setCandidateValue(null); setError("");
  };
  const enter = () => {
   if (!live.current.access?.canRequest || live.current.original.disabled || pending.current || live.current.access.canMutate()) return;
   pending.current = true;
   void live.current.access.requestEdit().then((ok) => {
    if (!active.current) return;
    pending.current = false; granted.current = ok;
    if (!ok && candidate.current) setError("Локальный ввод сохранён отдельно. Повторите вход в редактирование.");
    window.setTimeout(finish, 0);
   });
  };
  return <>{createElement(tag, {
   ...props,
   ref: (node: Element | null) => {
    element.current = node;
    if (typeof forwarded === "function") forwarded(node);
    else if (forwarded) (forwarded as { current: Element | null }).current = node;
   },
   value: candidateValue ?? original.value,
   disabled: tag === "select" ? original.disabled : false,
   readOnly: tag === "select" ? undefined : Boolean(original.disabled || access && !access.canMutate() && !access.canRequest),
   onFocus: (event: FocusEvent<Element>) => { enter(); original.onFocus?.(event); },
   onChange: (event: ChangeEvent<Element>) => {
    if (original.disabled) return;
    if (!access || (access.canMutate() && !candidate.current)) { original.onChange?.(event); return; }
    if (!access.canRequest) return;
    const target = event.target;
    candidate.current = { value: target.value, base: candidate.current?.base ?? original.value,
      start: "selectionStart" in target ? target.selectionStart : null, end: "selectionEnd" in target ? target.selectionEnd : null };
    access.storeCandidate?.(candidateId(), { text: target.value });
    setCandidateValue(target.value); enter();
    if (access.canMutate()) { granted.current = true; finish(); }
   },
   onKeyDown: (event: KeyboardEvent<Element>) => { if (!access || access.canMutate()) original.onKeyDown?.(event); },
   onBlur: (event: FocusEvent<Element>) => { if (!access || (access.canMutate() && !candidate.current)) original.onBlur?.(event); },
   onCompositionStart: () => { composing.current = true; },
   onCompositionEnd: () => { composing.current = false; window.setTimeout(finish, 0); },
  })}{error && <small role="status">{error}</small>}</>;
 });
}
export const AccessInput = nativeField<"input", HTMLInputElement>("input");
export const AccessTextarea = nativeField<"textarea", HTMLTextAreaElement>("textarea");
export const AccessSelect = nativeField<"select", HTMLSelectElement>("select");
