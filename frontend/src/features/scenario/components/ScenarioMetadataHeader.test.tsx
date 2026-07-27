import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ScenarioMetadataHeader from "./ScenarioMetadataHeader";

const rubrics = [
  { id: 1, name: "Новости" },
  { id: 2, name: "Специальный репортаж" },
  { id: 3, name: "Спорт" },
];

function jsonResponse(): Response {
  return new Response(JSON.stringify({
    ok: true,
    event_id: null,
    changed_at: "2026-07-27T00:00:00Z",
    resource: { type: "story", id: 101 },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Response>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ScenarioMetadataHeader request ordering", () => {
  it("ignores a stale title response that arrives after the latest save", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onChanged = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{ id: 101, title: "Исходный заголовок", rubric: rubrics[0] }}
        editable
        rubrics={rubrics}
        onChanged={onChanged}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Название" });
    fireEvent.change(input, { target: { value: "Первый заголовок" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "Последний заголовок" } });
    fireEvent.blur(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(jsonResponse());
      await second.promise;
    });
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(onChanged).toHaveBeenLastCalledWith({ title: "Последний заголовок" });
    });

    await act(async () => {
      first.resolve(jsonResponse());
      await first.promise;
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("Последний заголовок");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not roll back the latest rubric when an older request fails", async () => {
    const first = deferredResponse();
    const second = deferredResponse();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onChanged = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{ id: 101, title: "Сюжет", rubric: rubrics[0] }}
        editable
        rubrics={rubrics}
        onChanged={onChanged}
      />,
    );

    const select = screen.getByRole("combobox", { name: "Рубрика" });
    fireEvent.change(select, { target: { value: "2" } });
    fireEvent.change(select, { target: { value: "3" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(jsonResponse());
      await second.promise;
    });
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(onChanged).toHaveBeenLastCalledWith({ rubric: rubrics[2] });
    });

    await act(async () => {
      first.reject(new Error("Старый запрос завершился ошибкой"));
      await first.promise.catch(() => undefined);
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(select).toHaveValue("3");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
