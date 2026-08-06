import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hasBlockedNavigation } from "../../../app/navigationGuard";
import { resetMetadataSaveCoordinatorsForTests } from "../metadataSaveCoordinator";
import ScenarioMetadataHeader from "./ScenarioMetadataHeader";

const rubrics = [
  { id: 1, name: "Новости" },
  { id: 2, name: "Специальный репортаж" },
  { id: 3, name: "Спорт" },
];
const originalTextareaScrollHeight = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "scrollHeight",
);

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
  if (originalTextareaScrollHeight) {
    Object.defineProperty(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
      originalTextareaScrollHeight,
    );
  } else {
    delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  }
  resetMetadataSaveCoordinatorsForTests();
  vi.unstubAllGlobals();
});

describe("ScenarioMetadataHeader request ordering", () => {
  it("renders an auto-growing title textarea and an empty duration from null", () => {
    render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Исходный заголовок",
          rubric: rubrics[0],
          duration_text: null,
        }}
        editable
        rubrics={rubrics}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Название" }).tagName).toBe("TEXTAREA");
    expect(screen.getByRole("textbox", { name: "Хронометраж" })).toHaveValue("");
  });

  it("keeps the title on one logical line and prevents Enter", () => {
    render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Исходный заголовок",
          rubric: rubrics[0],
          duration_text: null,
        }}
        editable
        rubrics={rubrics}
      />,
    );

    const title = screen.getByRole("textbox", { name: "Название" });
    fireEvent.change(title, { target: { value: "Первая\nВторая" } });

    expect(title).toHaveValue("Первая Вторая");
    expect(fireEvent.keyDown(title, { key: "Enter" })).toBe(false);
    expect(title).toHaveValue("Первая Вторая");
  });

  it("grows the existing title textarea without resetting focus or page scroll", () => {
    const scrollTo = vi.spyOn(window, "scrollTo");
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return (this as HTMLTextAreaElement).value.length > 30 ? 76 : 38;
      },
    });
    render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Короткое название",
          rubric: rubrics[0],
          duration_text: null,
        }}
        editable
        rubrics={rubrics}
      />,
    );

    const title = screen.getByRole("textbox", { name: "Название" }) as HTMLTextAreaElement;
    const originalNode = title;
    title.focus();
    fireEvent.change(title, {
      target: {
        value: "Очень длинное синтетическое название для переноса в шапке",
        selectionStart: 12,
        selectionEnd: 12,
      },
    });

    expect(screen.getByRole("textbox", { name: "Название" })).toBe(originalNode);
    expect(title).toHaveFocus();
    expect(title.selectionStart).toBe(12);
    expect(title.selectionEnd).toBe(12);
    expect(title.style.height).toBe("76px");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("trims duration, clears it with explicit null and respects editability", async () => {
    const payloads: Array<{ duration_text?: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body)));
      return Promise.resolve(jsonResponse());
    }));
    const onChanged = vi.fn();
    const view = render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Исходный заголовок",
          rubric: rubrics[0],
          duration_text: " 02:30 ",
        }}
        editable
        rubrics={rubrics}
        onChanged={onChanged}
      />,
    );

    const duration = screen.getByRole("textbox", { name: "Хронометраж" });
    expect(duration).toHaveAttribute("maxlength", "64");
    fireEvent.change(duration, { target: { value: " 03:45 " } });
    fireEvent.blur(duration);

    await waitFor(() => expect(payloads).toEqual([{ duration_text: "03:45" }]));
    expect(onChanged).toHaveBeenLastCalledWith({ duration_text: "03:45" });

    fireEvent.change(duration, { target: { value: "   " } });
    fireEvent.blur(duration);
    await waitFor(() => expect(payloads).toEqual([
      { duration_text: "03:45" },
      { duration_text: null },
    ]));
    expect(onChanged).toHaveBeenLastCalledWith({ duration_text: null });

    view.rerender(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Исходный заголовок",
          rubric: rubrics[0],
          duration_text: null,
        }}
        editable={false}
        rubrics={rubrics}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Хронометраж" })).toBeDisabled();
  });

  it("показывает выбранную отключённую рубрику, но не предлагает выбрать её повторно", () => {
    render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Сюжет с отключённой рубрикой",
          rubric: { id: 9, name: "Архивная рубрика" },
          duration_text: null,
        }}
        editable
        rubrics={rubrics}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Рубрика" })).toHaveValue("9");
    expect(screen.getByRole("option", { name: "Архивная рубрика" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "Новости" })).toBeEnabled();
  });

  it("serializes metadata saves and commits the latest title, rubric and duration on the server", async () => {
    const first = deferredResponse();
    const server = { title: "Исходный заголовок", rubricId: 1, durationText: null as string | null };
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const payloads: Array<{
      title?: string;
      rubric_id?: number;
      duration_text?: string | null;
    }> = [];
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
        if (payload.duration_text !== undefined) server.durationText = payload.duration_text;
        activeRequests -= 1;
        return response;
      });
    });
    const onChanged = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Исходный заголовок",
          rubric: rubrics[0],
          duration_text: null,
        }}
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
    const duration = screen.getByRole("textbox", { name: "Хронометраж" });
    fireEvent.change(duration, { target: { value: " 04:20 " } });
    fireEvent.blur(duration);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(maxActiveRequests).toBe(1);
    expect(onChanged).not.toHaveBeenCalled();

    await act(async () => {
      first.resolve(jsonResponse());
      await first.promise;
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(server).toEqual({
        title: "Последний заголовок",
        rubricId: 2,
        durationText: "04:20",
      });
    });
    expect(payloads).toEqual([
      { title: "Первый заголовок" },
      { title: "Последний заголовок", rubric_id: 2, duration_text: "04:20" },
    ]);
    expect(maxActiveRequests).toBe(1);
    expect(onChanged).toHaveBeenLastCalledWith({
      title: "Последний заголовок",
      rubric: rubrics[1],
      duration_text: "04:20",
    });
    expect(input).toHaveValue("Последний заголовок");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("omits a rubric missing from the latest options when reporting an acknowledged patch", async () => {
    const save = deferredResponse();
    vi.stubGlobal("fetch", vi.fn(() => save.promise));
    const onChanged = vi.fn();
    const view = render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Исходный заголовок",
          rubric: rubrics[0],
          duration_text: null,
        }}
        editable
        rubrics={rubrics}
        onChanged={onChanged}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Название" }), {
      target: { value: "Сохранённый заголовок" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Рубрика" }), {
      target: { value: "2" },
    });
    view.rerender(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Исходный заголовок",
          rubric: rubrics[0],
          duration_text: null,
        }}
        editable
        rubrics={rubrics.filter((rubric) => rubric.id !== 2)}
        onChanged={onChanged}
      />,
    );

    await act(async () => {
      save.resolve(jsonResponse());
      await save.promise;
    });

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const patch = onChanged.mock.calls.at(-1)?.[0];
    expect(patch).toEqual({ title: "Сохранённый заголовок" });
    expect(Object.prototype.hasOwnProperty.call(patch, "rubric")).toBe(false);
  });

  it("omits a missing persisted rubric during initial reconciliation after remount", async () => {
    const save = deferredResponse();
    vi.stubGlobal("fetch", vi.fn(() => save.promise));
    const firstView = render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Исходный заголовок",
          rubric: rubrics[0],
          duration_text: null,
        }}
        editable
        rubrics={rubrics}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Название" }), {
      target: { value: "Сохранённый заголовок" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Рубрика" }), {
      target: { value: "2" },
    });
    firstView.unmount();
    await act(async () => {
      save.resolve(jsonResponse());
      await save.promise;
    });

    const onChanged = vi.fn();
    render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Исходный заголовок",
          rubric: rubrics[0],
          duration_text: null,
        }}
        editable
        rubrics={rubrics.filter((rubric) => rubric.id !== 2)}
        onChanged={onChanged}
      />,
    );

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const patch = onChanged.mock.calls.at(-1)?.[0];
    expect(patch).toEqual({ title: "Сохранённый заголовок" });
    expect(Object.prototype.hasOwnProperty.call(patch, "rubric")).toBe(false);
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
        story={{
          id: 101,
          title: server.title,
          rubric: rubrics[0],
          duration_text: null,
        }}
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

  it("preserves explicit null while projecting an in-flight duration clear", async () => {
    const first = deferredResponse();
    const server = { durationText: "01:00" as string | null };
    const payloads: Array<{ duration_text: string | null }> = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { duration_text: string | null };
      payloads.push(payload);
      const responsePromise = payloads.length === 1
        ? first.promise
        : Promise.resolve(jsonResponse());
      return responsePromise.then((response) => {
        server.durationText = payload.duration_text;
        return response;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Исходный заголовок",
          rubric: rubrics[0],
          duration_text: "01:00",
        }}
        editable
        rubrics={rubrics}
      />,
    );
    const duration = screen.getByRole("textbox", { name: "Хронометраж" });
    fireEvent.change(duration, { target: { value: "" } });
    fireEvent.blur(duration);
    fireEvent.change(duration, { target: { value: "01:00" } });
    fireEvent.blur(duration);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloads).toEqual([{ duration_text: null }]);

    await act(async () => {
      first.resolve(jsonResponse());
      await first.promise;
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(server.durationText).toBe("01:00");
    });
    expect(payloads).toEqual([
      { duration_text: null },
      { duration_text: "01:00" },
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
        story={{
          id: 101,
          title: "Исходный заголовок",
          rubric: rubrics[0],
          duration_text: null,
        }}
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

  it("keeps one in-flight save across unmount/remount and commits the latest desired value", async () => {
    const first = deferredResponse();
    const server = { title: "Исходный заголовок" };
    const payloads: Array<{ title: string }> = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      payloads.push(payload);
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      const responsePromise = payloads.length === 1
        ? first.promise
        : Promise.resolve(jsonResponse());
      return responsePromise.then((response) => {
        server.title = payload.title;
        activeRequests -= 1;
        return response;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: server.title,
          rubric: rubrics[0],
          duration_text: null,
        }}
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
    expect(hasBlockedNavigation()).toBe(true);
    const remounted = render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: "Исходный заголовок",
          rubric: rubrics[0],
          duration_text: null,
        }}
        editable
        rubrics={rubrics}
      />,
    );
    const remountedInput = screen.getByRole("textbox", { name: "Название" });
    expect(remountedInput).toHaveValue("Последний заголовок");
    fireEvent.change(remountedInput, { target: { value: "После возврата" } });
    fireEvent.blur(remountedInput);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(jsonResponse());
      await first.promise;
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(server.title).toBe("После возврата");
      expect(hasBlockedNavigation()).toBe(false);
    });
    expect(maxActiveRequests).toBe(1);
    remounted.unmount();
  });

  it("preserves a failed desired value across remount and exposes retry", async () => {
    let attempts = 0;
    const server = { title: "Исходный заголовок" };
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1;
      const payload = JSON.parse(String(init?.body)) as { title: string };
      if (attempts === 1) {
        return Promise.resolve(new Response(JSON.stringify({
          error: { code: "CONFLICT", message: "Сохранение отклонено" },
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }));
      }
      server.title = payload.title;
      return Promise.resolve(jsonResponse());
    }));

    const firstView = render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: server.title,
          rubric: rubrics[0],
          duration_text: null,
        }}
        editable
        rubrics={rubrics}
      />,
    );
    const input = screen.getByRole("textbox", { name: "Название" });
    fireEvent.change(input, { target: { value: "Локальный заголовок" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Сохранение отклонено")).toBeInTheDocument();
    firstView.unmount();
    expect(hasBlockedNavigation()).toBe(true);

    render(
      <ScenarioMetadataHeader
        storyId={101}
        story={{
          id: 101,
          title: server.title,
          rubric: rubrics[0],
          duration_text: null,
        }}
        editable
        rubrics={rubrics}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Название" })).toHaveValue(
      "Локальный заголовок",
    );
    expect(screen.getByText("Сохранение отклонено")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Повторить сохранение данных сюжета" }),
    );

    await waitFor(() => {
      expect(server.title).toBe("Локальный заголовок");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(hasBlockedNavigation()).toBe(false);
    });
  });
});
