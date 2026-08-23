import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ScenarioSearchPanel from "./ScenarioSearchPanel";
import type { ScenarioSearchMatch } from "../scenarioSearch";

const matches: ScenarioSearchMatch[] = [
  {
    segmentUid: "seg_1",
    target: "text",
    from: 0,
    to: 3,
    ordinal: 0,
    sourceText: "мир и мир",
  },
  {
    segmentUid: "seg_1",
    target: "text",
    from: 6,
    to: 9,
    ordinal: 1,
    sourceText: "мир и мир",
  },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof ScenarioSearchPanel>> = {}) {
  const callbacks = {
    onQueryChange: vi.fn(),
    onReplacementChange: vi.fn(),
    onMatchCaseChange: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onReplace: vi.fn(),
    onReplaceAll: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <ScenarioSearchPanel
      mode="replace"
      query="мир"
      replacement="свет"
      matchCase={false}
      activeIndex={0}
      matches={matches}
      editable
      {...callbacks}
      {...overrides}
    />,
  );
  return callbacks;
}

describe("ScenarioSearchPanel", () => {
  it("shows Russian search controls, focuses the query and reports the active match", () => {
    renderPanel();

    expect(screen.getByRole("search", { name: "Найти и заменить" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Найти" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "Заменить на" })).toHaveValue("свет");
    expect(screen.getByRole("status")).toHaveTextContent("1 из 2");
    expect(screen.getByRole("checkbox", { name: "Учитывать регистр" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Предыдущее совпадение" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Следующее совпадение" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Заменить" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Заменить всё" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Закрыть поиск" })).toBeEnabled();
  });

  it("delegates previous, next and match-case changes for controlled cyclic navigation", async () => {
    const user = userEvent.setup();
    const callbacks = renderPanel({ activeIndex: 1 });

    await user.click(screen.getByRole("button", { name: "Следующее совпадение" }));
    await user.click(screen.getByRole("button", { name: "Предыдущее совпадение" }));
    await user.click(screen.getByRole("checkbox", { name: "Учитывать регистр" }));
    await user.click(screen.getByRole("button", { name: "Заменить" }));
    await user.click(screen.getByRole("button", { name: "Заменить всё" }));

    expect(callbacks.onNext).toHaveBeenCalledOnce();
    expect(callbacks.onPrevious).toHaveBeenCalledOnce();
    expect(callbacks.onMatchCaseChange).toHaveBeenCalledWith(true);
    expect(callbacks.onReplace).toHaveBeenCalledOnce();
    expect(callbacks.onReplaceAll).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("2 из 2");
  });

  it("disables mutations with no active match, an empty query or read-only access", () => {
    const { rerender } = render(
      <ScenarioSearchPanel
        mode="replace"
        query="нет"
        replacement=""
        matchCase={false}
        activeIndex={0}
        matches={[]}
        editable
        onQueryChange={() => undefined}
        onReplacementChange={() => undefined}
        onMatchCaseChange={() => undefined}
        onPrevious={() => undefined}
        onNext={() => undefined}
        onReplace={() => undefined}
        onReplaceAll={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("0 из 0");
    expect(screen.getByRole("button", { name: "Заменить" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Заменить всё" })).toBeDisabled();

    rerender(
      <ScenarioSearchPanel
        mode="replace"
        query=""
        replacement=""
        matchCase={false}
        activeIndex={0}
        matches={matches}
        editable
        onQueryChange={() => undefined}
        onReplacementChange={() => undefined}
        onMatchCaseChange={() => undefined}
        onPrevious={() => undefined}
        onNext={() => undefined}
        onReplace={() => undefined}
        onReplaceAll={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Заменить всё" })).toBeDisabled();

    rerender(
      <ScenarioSearchPanel
        mode="replace"
        query="мир"
        replacement=""
        matchCase={false}
        activeIndex={0}
        matches={matches}
        editable={false}
        onQueryChange={() => undefined}
        onReplacementChange={() => undefined}
        onMatchCaseChange={() => undefined}
        onPrevious={() => undefined}
        onNext={() => undefined}
        onReplace={() => undefined}
        onReplaceAll={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Заменить" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Заменить всё" })).toBeDisabled();
  });

  it("closes on Escape and consumes only that panel key", () => {
    const callbacks = renderPanel();
    const query = screen.getByRole("searchbox", { name: "Найти" });

    expect(fireEvent.keyDown(query, { key: "Escape" })).toBe(false);
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });

  it("returns focus to the query when the open panel changes mode", () => {
    const props = {
      query: "мир",
      replacement: "",
      matchCase: false,
      activeIndex: 0,
      matches,
      editable: true,
      onQueryChange: () => undefined,
      onReplacementChange: () => undefined,
      onMatchCaseChange: () => undefined,
      onPrevious: () => undefined,
      onNext: () => undefined,
      onReplace: () => undefined,
      onReplaceAll: () => undefined,
      onClose: () => undefined,
    };
    const { rerender } = render(<ScenarioSearchPanel mode="find" {...props} />);
    screen.getByRole("button", { name: "Закрыть поиск" }).focus();

    rerender(<ScenarioSearchPanel mode="replace" {...props} />);

    expect(screen.getByRole("searchbox", { name: "Найти" })).toHaveFocus();
  });

  it("returns focus to the query for a repeated same-mode open request", () => {
    const props = {
      mode: "find" as const,
      query: "мир",
      replacement: "",
      matchCase: false,
      activeIndex: 0,
      matches,
      editable: true,
      onQueryChange: () => undefined,
      onReplacementChange: () => undefined,
      onMatchCaseChange: () => undefined,
      onPrevious: () => undefined,
      onNext: () => undefined,
      onReplace: () => undefined,
      onReplaceAll: () => undefined,
      onClose: () => undefined,
    };
    const { rerender } = render(<ScenarioSearchPanel {...props} focusRequest={0} />);
    screen.getByRole("button", { name: "Закрыть поиск" }).focus();

    rerender(<ScenarioSearchPanel {...props} focusRequest={1} />);

    expect(screen.getByRole("searchbox", { name: "Найти" })).toHaveFocus();
    expect(screen.getByRole("searchbox", { name: "Найти" })).toHaveValue("мир");
  });

  it("clamps an out-of-range active match before announcing it", () => {
    renderPanel({ activeIndex: -3 });

    expect(screen.getByRole("status")).toHaveTextContent("1 из 2");
  });
});
