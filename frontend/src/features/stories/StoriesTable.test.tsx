import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import StoriesTable from "./components/StoriesTable";
import type { StoryListItem } from "./types";

const story: StoryListItem = {
  id: 101,
  title: "Синтетический выпуск",
  priority: { code: "high", label: "Высокий" },
  rubric: { id: 7, name: "Тестовая рубрика" },
  author: {
    id: 1,
    username: "synthetic_author",
    display_name: "Тест",
    position: "Корреспондент",
    function_codes: ["author"],
  },
  situation: { code: "active", label: "В работе" },
  assignments: [
    {
      kind: "video",
      user: {
        id: 2,
        username: "synthetic_editor",
        display_name: "Редактор",
        position: "Монтажёр",
        function_codes: ["video"],
      },
    },
  ],
  created_at: "2026-07-12T09:00:00Z",
  archived_at: null,
};

describe("StoriesTable", () => {
  it("показывает согласованные колонки и открывает сценарий выбранного сюжета", async () => {
    const onOpenScenario = vi.fn();
    const user = userEvent.setup();

    render(<StoriesTable items={[story]} onOpenScenario={onOpenScenario} />);

    expect(screen.getByRole("columnheader", { name: "Приоритет" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Название" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Рубрика" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Автор" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Что происходит" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Исполнители" })).toBeVisible();
    expect(screen.getByText("Синтетический выпуск")).toBeVisible();
    expect(screen.getByText("Высокий")).toBeVisible();
    expect(screen.getByText("Монтажёр: Редактор")).toBeVisible();

    await user.click(screen.getByRole("link", { name: "Открыть сценарий сюжета Синтетический выпуск" }));

    expect(onOpenScenario).toHaveBeenCalledWith(101);
  });
});
