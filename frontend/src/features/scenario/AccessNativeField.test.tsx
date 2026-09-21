import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { normalizeTimecodeDisplayValue } from "./scenarioTableModel";
import { AccessInput } from "./AccessNativeField";
import { ScenarioAccessContext } from "./ScenarioAccessContext";
import { createDeferred } from "../../test/deferred";
describe("native access candidate", () => {
 it("buffers the first typed file name and commits only after owned grant", async () => {
  let allowed = false; const pending = createDeferred<boolean>(); const changed = vi.fn();
  render(<ScenarioAccessContext.Provider value={{ canMutate: () => allowed, canRequest: true, requestEdit: () => pending.promise }}><AccessInput aria-label="Файл" value="старый" onChange={changed} /></ScenarioAccessContext.Provider>);
  const field = screen.getByRole("textbox");
  fireEvent.focus(field); fireEvent.change(field, { target: { value: "новый" } });
  expect(changed).not.toHaveBeenCalled(); expect(field).toHaveValue("новый");
  await act(async () => { allowed = true; pending.resolve(true); });
  await waitFor(() => expect(changed).toHaveBeenCalledOnce()); expect(changed.mock.calls[0][0].target.value).toBe("новый");
 });
});

it("replays a deferred change and blur once, normalizes TC, and leaves focus where the user moved it", async () => {
 let allowed = false;
 const pending = createDeferred<boolean>();
 const changed = vi.fn(); const blurred = vi.fn();
 function Field() {
  const [value, setValue] = useState("");
  return <ScenarioAccessContext.Provider value={{ canMutate: () => allowed, canRequest: true, requestEdit: () => pending.promise }}>
   <AccessInput aria-label="TC" value={value} onChange={(event) => { changed(event.target.value); setValue(event.target.value); }} onBlur={(event) => { blurred(event.target.value); setValue(normalizeTimecodeDisplayValue(event.target.value)); }} />
   <button type="button">Другое поле</button>
  </ScenarioAccessContext.Provider>;
 }
 render(<Field />);
 const field = screen.getByRole("textbox", { name: "TC" }); const next = screen.getByRole("button");
 act(() => { field.focus(); });
 fireEvent.change(field, { target: { value: "010203" } });
 act(() => { next.focus(); });
 expect(changed).not.toHaveBeenCalled(); expect(blurred).not.toHaveBeenCalled();
 await act(async () => { allowed = true; pending.resolve(true); });
 await waitFor(() => expect(field).toHaveValue("01:02:03"));
 expect(changed).toHaveBeenCalledOnce(); expect(blurred).toHaveBeenCalledOnce(); expect(next).toHaveFocus();
});
