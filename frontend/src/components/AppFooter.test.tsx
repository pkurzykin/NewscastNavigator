import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AppFooter from "./AppFooter";

vi.mock("../appVersion", () => ({ APP_VERSION: "1.0.1" }));

describe("AppFooter", () => {
  it("renders the accessible version and copyright text without interactive controls", () => {
    render(<AppFooter />);

    expect(screen.getByText("Newscast Navigator v1.0.1 · © 2026 Павел Курзыкин. Все права защищены.")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
