import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AppFooter from "./AppFooter";

const layoutStyles = readFileSync(resolve(process.cwd(), "src/styles/layout.css"), "utf-8");

describe("AppFooter", () => {
  it("renders the accessible version and copyright text without interactive controls", () => {
    render(<AppFooter />);

    expect(screen.getByText("Newscast Navigator v1.0.1 · © 2026 Павел Курзыкин. Все права защищены.")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the auth footer at the bottom while centering only the auth content", () => {
    expect(layoutStyles).toContain(".auth-layout");
    expect(layoutStyles).toContain("grid-template-rows: 1fr auto");
    expect(layoutStyles).toContain(".auth-layout > main");
    expect(layoutStyles).toContain("align-self: center");
    expect(layoutStyles).not.toMatch(/\.auth-layout\s*\{[^}]*align-content:\s*center/);
  });
});
