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
  updated_at: "2026-07-12T10:15:00Z",
  archived_at: null,
  management: {
    action: {
      code: "story_management_update",
      label: "Изменить автора или приоритет",
      method: "PATCH",
      href: "/api/v1/stories/101/management",
      emphasis: "normal",
      confirmation: null,
      form: null,
    },
    author_options: [],
    priority_options: [
      { code: "standard", label: "Стандарт" },
      { code: "high", label: "Высокий" },
    ],
  },
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
    expect(screen.getByRole("columnheader", { name: "Изменён" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Создан" })).toBeVisible();
    expect(screen.getByText("Синтетический выпуск")).toBeVisible();
    expect(screen.getByText("Монтажёр: Редактор")).toBeVisible();
    expect(screen.getByText("12.07.2026, 13:15")).toBeVisible();
    expect(screen.getByText("12.07.2026, 12:00")).toBeVisible();

    await user.click(screen.getByRole("link", { name: "Открыть сценарий сюжета Синтетический выпуск" }));

    expect(onOpenScenario).toHaveBeenCalledWith(101);
  });

  it("передаёт выбранный руководством приоритет", async () => {
    const onPriorityChange = vi.fn();
    const user = userEvent.setup();

    render(
      <StoriesTable
        items={[story]}
        onOpenScenario={vi.fn()}
        onPriorityChange={onPriorityChange}
      />,
    );

    await user.selectOptions(
      screen.getByRole("combobox", {
        name: "Приоритет сюжета Синтетический выпуск",
      }),
      "standard",
    );

    expect(onPriorityChange).toHaveBeenCalledWith(story, "standard");
  });

  it("сохраняет читаемым текущего автора, если он больше не доступен для назначения", () => {
    render(
      <StoriesTable
        items={[{
          ...story,
          management: {
            ...story.management!,
            author_options: [{
              id: 2,
              username: "replacement",
              display_name: "Доступный автор",
              position: "Корреспондент",
              function_codes: ["author"],
            }],
          },
        }]}
        onOpenScenario={vi.fn()}
        onAuthorChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", {
      name: "Автор сюжета Синтетический выпуск",
    })).toHaveValue("1");
    expect(screen.getByRole("option", {
      name: "Тест · Корреспондент (недоступен)",
    })).toBeDisabled();
    expect(screen.getByRole("option", {
      name: "Доступный автор · Корреспондент",
    })).toBeEnabled();
  });

  it("блокирует все селекторы приоритета, пока меняется любой сюжет", () => {
    render(
      <StoriesTable
        items={[
          story,
          {
            ...story,
            id: 102,
            title: "Второй синтетический выпуск",
            management: {
              ...story.management!,
              action: {
                ...story.management!.action,
                href: "/api/v1/stories/102/management",
              },
            },
          },
        ]}
        onOpenScenario={vi.fn()}
        onPriorityChange={vi.fn()}
        managementPendingStoryId={101}
      />,
    );

    expect(screen.getByRole("combobox", {
      name: "Приоритет сюжета Синтетический выпуск",
    })).toBeDisabled();
    expect(screen.getByRole("combobox", {
      name: "Приоритет сюжета Второй синтетический выпуск",
    })).toBeDisabled();
  });
});
