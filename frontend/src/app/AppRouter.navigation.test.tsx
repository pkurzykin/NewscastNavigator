import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigate, useLocationHref } from "./AppRouter";
import { registerNavigationBlocker } from "./navigationGuard";

function LocationHarness() {
  const location = useLocationHref();
  return (
    <div>
      <output aria-label="Текущий маршрут">{location}</output>
      <input aria-label="Редактор" defaultValue="Локальный текст" />
      <a href="/stories/101/production">Производство</a>
      <a href="#correction-package-44">Пакет правок №44</a>
      <a href="history?session=9#diff">Относительная история</a>
    </div>
  );
}

describe("SPA navigation guard", () => {
  let unregister: (() => void) | undefined;

  beforeEach(() => {
    window.history.replaceState({}, "", "/stories/101/scenario");
  });

  afterEach(() => {
    unregister?.();
    unregister = undefined;
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("cancels programmatic and intercepted-link navigation without losing route or focus", () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirm);
    unregister = registerNavigationBlocker(() => true);
    render(<LocationHarness />);
    const editor = screen.getByRole("textbox", { name: "Редактор" });
    editor.focus();

    expect(navigate("/stories")).toBe(false);
    expect(window.location.pathname).toBe("/stories/101/scenario");
    expect(document.activeElement).toBe(editor);

    fireEvent.click(screen.getByRole("link", { name: "Производство" }));

    expect(window.location.pathname).toBe("/stories/101/scenario");
    expect(screen.getByRole("status", { name: "Текущий маршрут" }))
      .toHaveTextContent("/stories/101/scenario");
    expect(document.activeElement).toBe(editor);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("restores the accepted route when browser back or forward is cancelled", () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("confirm", confirm);
    unregister = registerNavigationBlocker(() => true);
    render(<LocationHarness />);

    act(() => {
      window.history.pushState({}, "", "/stories");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(window.location.pathname).toBe("/stories/101/scenario");
    expect(screen.getByRole("status", { name: "Текущий маршрут" }))
      .toHaveTextContent("/stories/101/scenario");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("allows a confirmed dirty transition while leaving persisted draft ownership untouched", () => {
    const confirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal("confirm", confirm);
    window.localStorage.setItem("newscast:scenario-draft:101:1", "preserved");
    unregister = registerNavigationBlocker(() => true);
    render(<LocationHarness />);

    let navigated = false;
    act(() => { navigated = navigate("/stories/101/history"); });
    expect(navigated).toBe(true);

    expect(window.location.pathname).toBe("/stories/101/history");
    expect(screen.getByRole("status", { name: "Текущий маршрут" }))
      .toHaveTextContent("/stories/101/history");
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1"))
      .toBe("preserved");
  });

  it("navigates clean state without prompting", () => {
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    render(<LocationHarness />);

    fireEvent.click(screen.getByRole("link", { name: "Производство" }));

    expect(window.location.pathname).toBe("/stories/101/production");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("resolves a production correction hash against the full current URL", () => {
    window.history.replaceState(
      {},
      "",
      "/stories/101/production?scope=open#production",
    );
    render(<LocationHarness />);

    fireEvent.click(screen.getByRole("link", { name: "Пакет правок №44" }));

    expect(window.location.pathname).toBe("/stories/101/production");
    expect(window.location.search).toBe("?scope=open");
    expect(window.location.hash).toBe("#correction-package-44");
    expect(screen.getByRole("status", { name: "Текущий маршрут" })).toHaveTextContent(
      "/stories/101/production?scope=open#correction-package-44",
    );
  });

  it("resolves programmatic and intercepted relative paths against the full current URL", () => {
    window.history.replaceState({}, "", "/stories/101/scenario?mode=review#row-4");
    render(<LocationHarness />);

    fireEvent.click(screen.getByRole("link", { name: "Относительная история" }));
    expect(window.location.href).toBe(
      "http://localhost:3000/stories/101/history?session=9#diff",
    );

    act(() => {
      navigate("production?scope=active#correction-package-7");
    });
    expect(window.location.href).toBe(
      "http://localhost:3000/stories/101/production?scope=active#correction-package-7",
    );
  });
});
