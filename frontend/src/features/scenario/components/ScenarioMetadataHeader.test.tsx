import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hasBlockedNavigation } from "../../../app/navigationGuard";
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
  it("показывает выбранную отключённую рубрику, но не предлагает выбрать её повторно", () => {
    render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Сюжет с отключённой рубрикой",
          rubric: { id: 9, name: "Архивная рубрика" },
        }}
        editable
        rubrics={rubrics}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Рубрика" })).toHaveValue("9");
    expect(screen.getByRole("option", { name: "Архивная рубрика" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "Новости" })).toBeEnabled();
  });

  it("serializes metadata saves and commits the latest title and rubric on the server", async () => {
    const first = deferredResponse();
    const server = { title: "Исходный заголовок", rubricId: 1 };
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const payloads: Array<{ title?: string; rubric_id?: number }> = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      payloads.push(payload);
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      const responsePromise = payloads.length === 1
        ? first.promise
        : Promise.resolve(jsonResponse());
      return responsePromise.then((response) => {
        if (payload.title !== undefined) server.title = payload.title;
        if (payload.rubric_id !== undefined) server.rubricId = payload.rubric_id;
        activeRequests -= 1;
        return response;
      });
    });
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
    fireEvent.change(screen.getByRole("combobox", { name: "Рубрика" }), {
      target: { value: "2" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(maxActiveRequests).toBe(1);

    await act(async () => {
      first.resolve(jsonResponse());
      await first.promise;
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(server).toEqual({ title: "Последний заголовок", rubricId: 2 });
    });
    expect(payloads).toEqual([
      { title: "Первый заголовок" },
      { title: "Последний заголовок", rubric_id: 2 },
    ]);
    expect(maxActiveRequests).toBe(1);
    expect(onChanged).toHaveBeenLastCalledWith({
      title: "Последний заголовок",
      rubric: rubrics[1],
    });
    expect(input).toHaveValue("Последний заголовок");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("queues a return to the persisted title while an older title is in flight", async () => {
    const first = deferredResponse();
    const server = { title: "Исходный заголовок" };
    const payloads: Array<{ title: string }> = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      payloads.push(payload);
      const responsePromise = payloads.length === 1
        ? first.promise
        : Promise.resolve(jsonResponse());
      return responsePromise.then((response) => {
        server.title = payload.title;
        return response;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{ id: 101, title: server.title, rubric: rubrics[0] }}
        editable
        rubrics={rubrics}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Название" });
    fireEvent.change(input, { target: { value: "Устаревший заголовок" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "Исходный заголовок" } });
    fireEvent.blur(input);

    await act(async () => {
      first.resolve(jsonResponse());
      await first.promise;
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(server.title).toBe("Исходный заголовок");
    });
    expect(payloads).toEqual([
      { title: "Устаревший заголовок" },
      { title: "Исходный заголовок" },
    ]);
    expect(hasBlockedNavigation()).toBe(false);
  });

  it("preserves failed metadata locally, blocks navigation and retries the latest value", async () => {
    let attempts = 0;
    const fetchMock = vi.fn(() => {
      attempts += 1;
      return Promise.resolve(attempts === 1
        ? new Response(JSON.stringify({
          error: { code: "LOCKED", message: "Не удалось сохранить данные сюжета" },
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        })
        : jsonResponse());
    });
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
    fireEvent.change(input, { target: { value: "Последний заголовок" } });
    fireEvent.blur(input);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось сохранить данные сюжета",
    );
    expect(input).toHaveValue("Последний заголовок");
    expect(hasBlockedNavigation()).toBe(true);
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Повторить сохранение данных сюжета" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(onChanged).toHaveBeenCalledWith({ title: "Последний заголовок" });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(hasBlockedNavigation()).toBe(false);
    });
  });

  it("finishes the queued latest save after the header unmounts", async () => {
    const first = deferredResponse();
    const server = { title: "Исходный заголовок" };
    const payloads: Array<{ title: string }> = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      payloads.push(payload);
      const responsePromise = payloads.length === 1
        ? first.promise
        : Promise.resolve(jsonResponse());
      return responsePromise.then((response) => {
        server.title = payload.title;
        return response;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{ id: 101, title: server.title, rubric: rubrics[0] }}
        editable
        rubrics={rubrics}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Название" });
    fireEvent.change(input, { target: { value: "Первый заголовок" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "Последний заголовок" } });
    fireEvent.blur(input);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(hasBlockedNavigation()).toBe(false);
    await act(async () => {
      first.resolve(jsonResponse());
      await first.promise;
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(server.title).toBe("Последний заголовок");
    });
  });
});
