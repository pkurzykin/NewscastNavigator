import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AutosaveStatus from "./AutosaveStatus";

describe("AutosaveStatus", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps routine autosave silent until it lasts for two seconds", () => {
    vi.useFakeTimers();
    render(<AutosaveStatus status="saving" error="" />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1_999); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });

    expect(screen.getByRole("status")).toHaveTextContent("Автосохранение...");
  });
});
