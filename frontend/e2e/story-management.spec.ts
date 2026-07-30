import { expect, test } from "@playwright/test";


const leader = {
  id: 1,
  username: "astra",
  display_name: "Астра",
  position: "Начальник",
  function_codes: ["author", "chief"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-30T08:00:00Z",
};
const author = {
  id: 2,
  username: "lira",
  display_name: "Лира",
  position: "Корреспондент",
  function_codes: ["author"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-30T08:00:00Z",
};
const managementAction = {
  code: "story_management_update",
  label: "Изменить автора или приоритет",
  method: "PATCH",
  href: "/api/v1/stories/101/management",
  emphasis: "normal",
  confirmation: null,
  form: null,
};
const rubricCreateAction = {
  code: "rubric_create",
  label: "Создать рубрику",
  method: "POST",
  href: "/api/v1/rubrics",
  emphasis: "normal",
  confirmation: null,
  form: null,
};

function rubricUpdateAction(id: number) {
  return {
    code: "rubric_update",
    label: "Изменить рубрику",
    method: "PATCH",
    href: `/api/v1/rubrics/${id}`,
    emphasis: "normal",
    confirmation: null,
    form: null,
  };
}

function ack(type: "story" | "rubric", id: number) {
  return {
    ok: true,
    event_id: type === "story" ? "story-management-101" : null,
    changed_at: "2026-07-30T09:00:00Z",
    resource: { type, id },
  };
}

test("leadership changes the author and manages the rubric registry", async ({ page }) => {
  let currentAuthor = leader;
  let nextRubricId = 8;
  let rubrics = [{
    id: 7,
    name: "Новости",
    is_active: true,
    update_action: rubricUpdateAction(7),
  }];
  const managementPayloads: unknown[] = [];
  const rubricPayloads: unknown[] = [];

  await page.context().addCookies([{
    name: "newscast_session",
    value: "synthetic-session",
    url: "http://127.0.0.1:5173",
  }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/v1/auth/me") return route.fulfill({ json: leader });
    if (path === "/api/v1/me/actions") {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === "/api/v1/notifications") {
      return route.fulfill({ json: { items: [], total: 0, unread_count: 0 } });
    }
    if (path === "/api/v1/stories/create-options") {
      return route.fulfill({
        json: {
          rubrics: rubrics
            .filter((item) => item.is_active)
            .map(({ id, name }) => ({ id, name })),
          authors: [leader, author],
          priority_options: [
            { code: "standard", label: "Стандарт" },
            { code: "high", label: "Высокий" },
          ],
          create_action: null,
          rubric_management: {
            items: rubrics,
            create_action: rubricCreateAction,
          },
        },
      });
    }
    if (path === "/api/v1/stories" && method === "GET") {
      return route.fulfill({
        json: {
          items: [{
            id: 101,
            title: "Синтетическое управление",
            priority: { code: "standard", label: "Стандарт" },
            rubric: { id: 7, name: rubrics[0].name },
            author: currentAuthor,
            situation: { code: "active", label: "В работе" },
            assignments: [],
            created_at: "2026-07-30T08:00:00Z",
            updated_at: "2026-07-30T09:00:00Z",
            aired_at: null,
            archived_at: null,
            lifecycle_actions: [],
            management: {
              action: managementAction,
              author_options: [leader, author],
              priority_options: [
                { code: "standard", label: "Стандарт" },
                { code: "high", label: "Высокий" },
              ],
            },
          }],
          total: 1,
        },
      });
    }
    if (path === managementAction.href && method === "PATCH") {
      const payload = request.postDataJSON();
      managementPayloads.push(payload);
      currentAuthor = author;
      return route.fulfill({ json: ack("story", 101) });
    }
    if (path === "/api/v1/rubrics" && method === "POST") {
      const payload = request.postDataJSON();
      rubricPayloads.push(payload);
      rubrics = [
        ...rubrics,
        {
          id: nextRubricId,
          name: payload.name,
          is_active: true,
          update_action: rubricUpdateAction(nextRubricId),
        },
      ];
      return route.fulfill({ json: ack("rubric", nextRubricId++) });
    }
    if (path === "/api/v1/rubrics/7" && method === "PATCH") {
      const payload = request.postDataJSON();
      rubricPayloads.push(payload);
      rubrics = rubrics.map((item) => item.id === 7 ? { ...item, ...payload } : item);
      return route.fulfill({ json: ack("rubric", 7) });
    }
    return route.fulfill({
      status: 404,
      json: {
        error: {
          code: "UNEXPECTED_TEST_REQUEST",
          message: `${method} ${path}`,
        },
      },
    });
  });

  await page.goto("/stories");

  const authorSelect = page.getByRole("combobox", {
    name: "Автор сюжета Синтетическое управление",
  });
  await authorSelect.selectOption(String(author.id));
  await expect.poll(() => managementPayloads).toEqual([{ author_user_id: author.id }]);
  await expect(authorSelect).toHaveValue(String(author.id));

  await page.getByRole("button", { name: "Рубрики" }).click();
  const dialog = page.getByRole("dialog", { name: "Управление рубриками" });
  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(dialogBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height);

  await dialog.getByLabel("Название новой рубрики").fill("Экономика");
  await dialog.getByRole("button", { name: "Создать рубрику" }).click();
  await expect(dialog.getByRole("textbox", {
    name: "Название рубрики Экономика",
  })).toHaveValue("Экономика");

  const currentName = dialog.getByRole("textbox", { name: "Название рубрики Новости" });
  await currentName.fill("Главные новости");
  await dialog.getByRole("button", { name: "Сохранить рубрику Новости" }).click();
  await expect(dialog.getByRole("textbox", {
    name: "Название рубрики Главные новости",
  })).toHaveValue("Главные новости");
  await dialog.getByRole("button", { name: "Отключить рубрику Главные новости" }).click();
  await expect(dialog.getByText("Отключена")).toBeVisible();

  expect(rubricPayloads).toEqual([
    { name: "Экономика" },
    { name: "Главные новости" },
    { is_active: false },
  ]);
});

test("ordinary user sees static author and no rubric management", async ({ page }) => {
  const ordinary = {
    ...author,
    is_active: true,
    must_change_password: false,
    created_at: "2026-07-30T08:00:00Z",
  };

  await page.context().addCookies([{
    name: "newscast_session",
    value: "synthetic-session",
    url: "http://127.0.0.1:5173",
  }]);
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/v1/auth/me") return route.fulfill({ json: ordinary });
    if (path === "/api/v1/me/actions") {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === "/api/v1/notifications") {
      return route.fulfill({ json: { items: [], total: 0, unread_count: 0 } });
    }
    if (path === "/api/v1/stories/create-options") {
      return route.fulfill({
        json: {
          rubrics: [{ id: 7, name: "Новости" }],
          authors: [author],
          priority_options: [{ code: "standard", label: "Стандарт" }],
          create_action: null,
          rubric_management: null,
        },
      });
    }
    if (path === "/api/v1/stories") {
      return route.fulfill({
        json: {
          items: [{
            id: 101,
            title: "Статический сюжет",
            priority: { code: "standard", label: "Стандарт" },
            rubric: { id: 7, name: "Новости" },
            author,
            situation: { code: "active", label: "В работе" },
            assignments: [],
            created_at: "2026-07-30T08:00:00Z",
            updated_at: "2026-07-30T09:00:00Z",
            aired_at: null,
            archived_at: null,
            lifecycle_actions: [],
            management: null,
          }],
          total: 1,
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: {
        error: {
          code: "UNEXPECTED_TEST_REQUEST",
          message: `${route.request().method()} ${path}`,
        },
      },
    });
  });

  await page.goto("/stories");

  await expect(page.getByRole("cell", { name: "Лира", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Автор сюжета/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Рубрики" })).toHaveCount(0);
});
