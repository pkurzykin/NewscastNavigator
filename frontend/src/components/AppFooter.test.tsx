import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AppFooter from "./AppFooter";

const layoutStyles = readFileSync(resolve(process.cwd(), "src/styles/layout.css"), "utf-8");

describe("AppFooter", () => {
  it("renders the accessible version and copyright text without interactive controls", () => {
    render(<AppFooter />);

    expect(screen.getByText("Newscast Navigator v1.1.0 · © 2026 Павел Курзыкин. Все права защищены.")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the auth footer at the bottom while centering only the auth content", () => {
    const authLayoutRule = layoutStyles.match(/(?:^|\n)\.auth-layout\s*\{([^}]*)\}/)?.[1] ?? "";
    const authMainRule = layoutStyles.match(/(?:^|\n)\.auth-layout\s*>\s*main\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(authLayoutRule).toContain("grid-template-rows: 1fr auto");
    expect(authLayoutRule).toContain("padding-bottom: 0");
    expect(authLayoutRule).not.toMatch(/align-content:\s*center/);
    expect(authMainRule).toContain("align-self: center");
  });
});
