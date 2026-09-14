import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
