import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../appVersion", () => ({ APP_VERSION: "1.3.0" }));

import type { CurrentUser } from "../../shared/contracts";
import AppShell from "./AppShell";

const user: CurrentUser = {
  id: 1,
  username: "astra",
  display_name: "Астра",
  position: "Начальник-корреспондент",
  function_codes: ["author", "chief"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-24T08:00:00Z",
};

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("newscast:whats-new:1:1.3.0", "seen");
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("AppShell Editorial Air identity", () => {
  it("keeps password and sign-out available through the compact profile menu", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, unread_count: 0 }))));
    const onPassword = vi.fn();
    const onLogout = vi.fn();
    const actor = userEvent.setup();
    render(<AppShell user={user} activeSection="stories" canManageUsers onOpenChangePassword={onPassword} onLogout={onLogout}><p>Рабочая область</p></AppShell>);
    const profile = screen.getByRole("button", { name: "Профиль: Астра" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await actor.click(profile);
    const profileMenu = screen.getByRole("menu", { name: "Профиль: Астра" });
    expect(profile).toHaveAttribute("id");
    expect(profile.id).not.toBe("");
    expect(profileMenu).toHaveAttribute("aria-labelledby", profile.id);
    await actor.click(screen.getByRole("menuitem", { name: "Сменить пароль" }));
    expect(onPassword).toHaveBeenCalledTimes(1);
    await actor.click(profile);
    await actor.click(screen.getByRole("menuitem", { name: "Выйти" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("shows the product identity without corporate artwork, company copy or raw function codes", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [],
      total: 0,
      unread_count: 0,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const { container } = render(
      <AppShell
        user={user}
        activeSection="stories"
        canManageUsers
        onOpenChangePassword={vi.fn()}
        onLogout={vi.fn()}
      >
        <p>Рабочая область</p>
      </AppShell>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Newscast Navigator" })).toBeVisible();
    expect(screen.getByText("Редакционный эфир")).toBeVisible();
    const home = screen.getByRole("link", { name: "На главную" });
    expect(home).toHaveAttribute("href", "/stories");
    expect(home).toContainElement(screen.getByRole("heading", { level: 1, name: "Newscast Navigator" }));
    expect(container.querySelector(".app-shell-header > .app-shell-header-inner")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(["транс", "нефт"].join(""), "i"))).not.toBeInTheDocument();
    expect(screen.queryByText(/author|chief/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Сюжеты" })).toHaveAttribute("aria-current", "page");
  });

  it("renders one footer after the working content", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [],
      total: 0,
      unread_count: 0,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const { container } = render(
      <AppShell
        user={user}
        activeSection="stories"
        canManageUsers
        onOpenChangePassword={vi.fn()}
        onLogout={vi.fn()}
      >
        <p>Рабочая область</p>
      </AppShell>,
    );

    const content = container.querySelector<HTMLElement>(".app-shell-content");
    const main = container.querySelector<HTMLElement>("main");
    const footer = container.querySelector<HTMLElement>(".app-footer");
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(main).toBeInTheDocument();
    expect(footer).toBeInTheDocument();
    expect(footer).toHaveTextContent("Newscast Navigator v1.3.0");
    expect(main).not.toContainElement(footer);
    expect(content?.compareDocumentPosition(footer!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(container.querySelectorAll(".app-footer")).toHaveLength(1);
  });

  it("connects the authenticated user to release notes for APP_VERSION", async () => {
    window.localStorage.removeItem("newscast:whats-new:1:1.3.0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [],
      total: 0,
      unread_count: 0,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    const userEventApi = userEvent.setup();
    render(
      <AppShell
        user={user}
        activeSection="stories"
        canManageUsers
        onOpenChangePassword={vi.fn()}
        onLogout={vi.fn()}
      >
        <button type="button">Рабочее действие</button>
      </AppShell>,
    );

    const dialog = screen.getByRole("dialog", { name: "Что нового в версии 1.3.0" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(7);
    expect(within(dialog).getByRole("button", { name: "Продолжить работу" })).toHaveFocus();

    await userEventApi.click(within(dialog).getByRole("button", { name: "Продолжить работу" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("newscast:whats-new:1:1.3.0")).toBe("seen");
  });
});
