import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { navigate, useLocationHref } from "./AppRouter";
import NavigationConfirmationDialog from "./NavigationConfirmationDialog";
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
      <NavigationConfirmationDialog />
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

  it("cancels programmatic and intercepted-link navigation without losing route or focus", async () => {
    unregister = registerNavigationBlocker(() => true);
    render(<LocationHarness />);
    const editor = screen.getByRole("textbox", { name: "Редактор" });
    editor.focus();

    act(() => expect(navigate("/stories")).toBe(false));
    let confirmation = screen.getByRole("alertdialog", { name: "Несохранённые изменения" });
    expect(confirmation).toHaveTextContent("Есть несохранённые изменения");
    fireEvent.click(screen.getByRole("button", { name: "Остаться" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(window.location.pathname).toBe("/stories/101/scenario");
    expect(document.activeElement).toBe(editor);

    fireEvent.click(screen.getByRole("link", { name: "Производство" }));
    confirmation = screen.getByRole("alertdialog", { name: "Несохранённые изменения" });
    fireEvent.click(screen.getByRole("button", { name: "Остаться" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    expect(window.location.pathname).toBe("/stories/101/scenario");
    expect(screen.getByRole("status", { name: "Текущий маршрут" }))
      .toHaveTextContent("/stories/101/scenario");
    expect(document.activeElement).toBe(editor);
    expect(confirmation).not.toBeInTheDocument();
  });

  it("restores the accepted route when a real browser back is cancelled", async () => {
    window.history.replaceState({ newscastNavigationPosition: 0 }, "", "/archive");
    window.history.pushState({ newscastNavigationPosition: 1 }, "", "/stories");
    window.history.pushState(
      { newscastNavigationPosition: 2 },
      "",
      "/stories/101/scenario",
    );
    unregister = registerNavigationBlocker(() => true);
    render(<LocationHarness />);

    act(() => window.history.back());
    await waitFor(() => expect(
      screen.getByRole("alertdialog", { name: "Несохранённые изменения" }),
    ).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Остаться" }));
    await waitFor(() => expect(window.location.pathname).toBe("/stories/101/scenario"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    expect(window.location.pathname).toBe("/stories/101/scenario");
    expect(screen.getByRole("status", { name: "Текущий маршрут" }))
      .toHaveTextContent("/stories/101/scenario");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("accepts a real browser back without duplicating the previous history entry", async () => {
    window.history.replaceState({ newscastNavigationPosition: 0 }, "", "/archive");
    window.history.pushState({ newscastNavigationPosition: 1 }, "", "/stories");
    window.history.pushState(
      { newscastNavigationPosition: 2 },
      "",
      "/stories/101/scenario",
    );
    unregister = registerNavigationBlocker(() => true);
    render(<LocationHarness />);

    act(() => window.history.back());
    await waitFor(() => expect(
      screen.getByRole("alertdialog", { name: "Несохранённые изменения" }),
    ).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Покинуть редактор" }));
    await waitFor(() => expect(window.location.pathname).toBe("/stories"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    unregister();
    unregister = undefined;
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe("/archive"));
    expect(screen.getByRole("status", { name: "Текущий маршрут" }))
      .toHaveTextContent("/archive");
  });

  it("invalidates a pending browser-back confirmation after a browser forward", async () => {
    window.history.replaceState({ newscastNavigationPosition: 0 }, "", "/archive");
    window.history.pushState({ newscastNavigationPosition: 1 }, "", "/stories");
    window.history.pushState(
      { newscastNavigationPosition: 2 },
      "",
      "/stories/101/scenario",
    );
    unregister = registerNavigationBlocker(() => true);
    render(<LocationHarness />);

    act(() => window.history.back());
    await waitFor(() => expect(
      screen.getByRole("alertdialog", { name: "Несохранённые изменения" }),
    ).toBeInTheDocument());

    act(() => window.history.forward());
    await waitFor(() => expect(window.location.pathname).toBe("/stories/101/scenario"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status", { name: "Текущий маршрут" }))
      .toHaveTextContent("/stories/101/scenario");
  });

  it("allows a confirmed dirty transition while leaving persisted draft ownership untouched", async () => {
    window.localStorage.setItem("newscast:scenario-draft:101:1", "preserved");
    unregister = registerNavigationBlocker(() => true);
    render(<LocationHarness />);

    let navigated = false;
    act(() => { navigated = navigate("/stories/101/history"); });
    expect(navigated).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Покинуть редактор" }));
    await waitFor(() => expect(window.location.pathname).toBe("/stories/101/history"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    expect(window.location.pathname).toBe("/stories/101/history");
    expect(screen.getByRole("status", { name: "Текущий маршрут" }))
      .toHaveTextContent("/stories/101/history");
    expect(window.localStorage.getItem("newscast:scenario-draft:101:1"))
      .toBe("preserved");
  });

  it("navigates clean state without prompting", () => {
    render(<LocationHarness />);

    fireEvent.click(screen.getByRole("link", { name: "Производство" }));

    expect(window.location.pathname).toBe("/stories/101/production");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
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
