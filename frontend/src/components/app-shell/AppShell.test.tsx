import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "../../shared/contracts";
import AppShell from "./AppShell";

vi.mock("../../appVersion", () => ({ APP_VERSION: "1.0.1" }));

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppShell Editorial Air identity", () => {
  it("shows the product identity without corporate artwork, company copy or raw function codes", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [],
      total: 0,
      unread_count: 0,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    render(
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
    expect(footer).toHaveTextContent("Newscast Navigator v1.0.1");
    expect(main).not.toContainElement(footer);
    expect(content?.compareDocumentPosition(footer!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(container.querySelectorAll(".app-footer")).toHaveLength(1);
  });
});
