import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { EditorCoreField } from "./EditorField";
import { ScenarioAccessContext } from "../scenario/ScenarioAccessContext";
import { createDeferred } from "../../test/deferred";
Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) });
describe("canonical editor access barrier", () => {
 it("blocks direct doc changes before grant, while selection remains available", async () => {
  let editor!: Editor;
  render(<ScenarioAccessContext.Provider value={{ canMutate: () => false, canRequest: true, requestEdit: async () => false }}><EditorCoreField editorId="row:text" richTextTarget={null} plainTextValue="Исходный" disabled={false} placeholder="" className="" ariaLabel="Текст" onFocusField={() => {}} onChangeValue={vi.fn()} onRegister={(_, instance) => { if (instance) editor = instance; }} onSelectionChange={() => {}} /></ScenarioAccessContext.Provider>);
  await waitFor(() => expect(editor).toBeDefined());
  act(() => { editor.commands.setTextSelection({ from: 1, to: 4 }); editor.commands.insertContent("ПОДМЕНА"); });
  expect(editor.getText()).toBe("Исходный");
  expect(editor.state.selection.from).toBe(1);
  expect(editor.state.selection.to).toBe(4);
 });
 it("keeps a separate input candidate until deferred grant and replays its rich text exactly once", async () => {
  let canonical!: Editor; let granted = false;
  const pending = createDeferred<boolean>();
  const change = vi.fn();
  render(<ScenarioAccessContext.Provider value={{ canMutate: () => granted, canRequest: true, requestEdit: () => pending.promise }}><EditorCoreField editorId="row:text" richTextTarget={null} plainTextValue="Исходный" disabled={false} placeholder="" className="" ariaLabel="Текст" onFocusField={() => {}} onChangeValue={change} onRegister={(_, instance) => { if (instance) canonical = instance; }} onSelectionChange={() => {}} /></ScenarioAccessContext.Provider>);
  await waitFor(() => expect(canonical).toBeDefined());
  fireEvent.focus(screen.getByRole("textbox", { name: "Текст" }));
  const candidate = await screen.findByRole("textbox", { name: "Локальный ввод: Текст" });
  await act(async () => { candidate.innerHTML = "<p><strong>Кандидат</strong></p>"; fireEvent.input(candidate); await new Promise((done) => setTimeout(done, 0)); });
  expect(canonical.getText()).toBe("Исходный");
  expect(change).not.toHaveBeenCalled();
  await act(async () => { granted = true; pending.resolve(true); });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Локальный ввод: Текст" })).toBeNull());
  expect(canonical.getText()).toBe("Кандидат");
  expect(change).toHaveBeenCalledOnce();
 });
});
