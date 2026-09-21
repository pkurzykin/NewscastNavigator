import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ScenarioHistoryControls from "./ScenarioHistoryControls";

describe("ScenarioHistoryControls", () => {
  it("exposes named undo and redo controls with truthful disabled states", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <ScenarioHistoryControls
        canUndo
        canRedo={false}
        onUndo={onUndo}
        onRedo={onRedo}
      />,
    );

    const undo = screen.getByRole("button", { name: "Отменить" });
    const redo = screen.getByRole("button", { name: "Повторить" });
    expect(undo).toHaveAttribute("title", "Отменить (Cmd/Ctrl+Z)");
    expect(redo).toHaveAttribute("title", "Повторить (Shift+Cmd/Ctrl+Z / Ctrl+Y)");
    expect(undo).toHaveClass("MuiIconButton-root");
    expect(redo).toHaveClass("MuiIconButton-root");
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();

    expect(fireEvent.mouseDown(undo)).toBe(false);
    fireEvent.click(undo);
    fireEvent.click(redo);
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).not.toHaveBeenCalled();
  });

  it("disables both controls when the editor is read-only", () => {
    render(
      <ScenarioHistoryControls
        canUndo
        canRedo
        disabled
        onUndo={() => undefined}
        onRedo={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Отменить" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeDisabled();
  });
});
