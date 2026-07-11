import { test, expect } from "./fixtures/current-editor";
import type { Page } from "@playwright/test";

const syntheticUser = {
  id: 1,
  username: "synthetic_admin",
  full_name: "Тест",
  job_title: "Тестовая должность",
  role: "admin",
  is_active: true,
  must_change_password: false,
  created_at: "2026-07-11T00:00:00Z",
};

const syntheticProject = {
  id: 101,
  title: "Синтетический browser-сценарий",
  rubric: "Тестовая рубрика",
  planned_duration: "01:30",
  status: "draft",
  author_user_id: 1,
  author_username: "synthetic_admin",
  executor_user_ids: [],
  text_seq: 1,
  current_text_seq: 1,
  current_text_is_latest: true,
  checked_text_is_current: false,
  proofread_text_is_current: false,
  latest_text_is_checked: false,
  latest_text_is_proofread: false,
  titles_status: "not_started",
  edit_status: "not_started",
  voiceover_status: "not_started",
  final_review_status: "not_started",
  open_action_comment_count: 0,
  my_open_action_comment_count: 0,
  my_in_progress_action_comment_count: 0,
  my_recently_resolved_action_comment_count: 0,
  created_at: "2026-07-11T00:00:00Z",
  status_changed_at: "2026-07-11T00:00:00Z",
};

function row(id: number, blockType: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    segment_uid: `seg_browser_${id}`,
    order_index: id,
    block_type: blockType,
    text,
    speaker_text: "",
    file_name: "",
    tc_in: "",
    tc_out: "",
    additional_comment: "",
    structured_data: {},
    formatting: {},
    rich_text: {
      schema_version: 1,
      targets: { text: { editor: "tiptap", text, html: text } },
    },
    ...extra,
  };
}

const syntheticRows = [
  row(1, "podvodka", "Ведущий открывает browser-выпуск", {
    rich_text: {
      schema_version: 1,
      targets: {
        text: {
          editor: "tiptap",
          text: "Ведущий открывает browser-выпуск",
          html: "<strong>Ведущий</strong> открывает browser-выпуск",
        },
      },
    },
  }),
  row(2, "zk", "Browser-закадр", {
    file_name: "synthetic-browser.mov",
    tc_in: "00:01",
    tc_out: "00:08",
    structured_data: {
      file_bundles: [
        { file_name: "synthetic-browser.mov", tc_in: "00:01", tc_out: "00:08" },
      ],
    },
  }),
  row(3, "zk_geo", "Browser-текст после гео", {
    structured_data: { geo: "Тестоград", text_lines: ["Browser-текст после гео"] },
    rich_text: {
      schema_version: 1,
      targets: {
        geo: { editor: "tiptap", text: "Тестоград", html: "<em>Тестоград</em>" },
        text: { editor: "tiptap", text: "Browser-текст после гео", html: "Browser-текст после гео" },
      },
    },
  }),
  row(4, "life", "Browser-интершум"),
  row(5, "snh", "Browser-реплика", {
    speaker_text: "Тестов Тест\nЭксперт лаборатории",
    rich_text: {
      schema_version: 1,
      targets: {
        speaker_fio: { editor: "tiptap", text: "Тестов Тест", html: "Тестов Тест" },
        speaker_position: {
          editor: "tiptap",
          text: "Эксперт лаборатории",
          html: "Эксперт лаборатории",
        },
        text: { editor: "tiptap", text: "Browser-реплика", html: "Browser-реплика" },
      },
    },
  }),
];

async function installSyntheticApi(page: Page) {
  await page.addInitScript(({ user }) => {
    window.localStorage.setItem("nn_web_auth_token", "synthetic-browser-token");
    window.localStorage.setItem("nn_web_auth_user", JSON.stringify(user));
  }, { user: syntheticUser });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/v1/auth/me") {
      await route.fulfill({ json: syntheticUser });
      return;
    }
    if (path === "/api/v1/projects" && method === "GET") {
      await route.fulfill({ json: { items: [syntheticProject], total: 1 } });
      return;
    }
    if (path === "/api/v1/projects/101/editor" && method === "GET") {
      await route.fulfill({ json: { project: syntheticProject, elements: syntheticRows } });
      return;
    }
    if (path === "/api/v1/projects/101/editor" && method === "PUT") {
      const requestRows = request.postDataJSON().rows;
      await route.fulfill({
        json: {
          ok: true,
          message: "Таблица сценария сохранена",
          updated: requestRows.length,
          inserted: 0,
          removed: 0,
          total: requestRows.length,
          project: syntheticProject,
          elements: requestRows,
        },
      });
      return;
    }
    if (path === "/api/v1/projects/101/meta" && method === "PUT") {
      await route.fulfill({ json: { ok: true, message: "Метаданные сохранены", project: syntheticProject } });
      return;
    }
    if (path === "/api/v1/projects/101/workspace") {
      await route.fulfill({
        json: {
          project: syntheticProject,
          workspace: { file_root: "", file_roots: [], project_note: "" },
          comments: [],
          material_links: [],
          files: [],
        },
      });
      return;
    }
    if (path === "/api/v1/users") {
      await route.fulfill({ json: { items: [syntheticUser], total: 1 } });
      return;
    }
    if (path === "/api/v1/projects/101/history" || path === "/api/v1/projects/101/revisions") {
      await route.fulfill({ json: { items: [], total: 0 } });
      return;
    }
    await route.fulfill({ status: 404, json: { detail: `Unexpected synthetic route: ${method} ${path}` } });
  });
}

async function openSyntheticEditor(page: Page) {
  await installSyntheticApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Сюжет Синтетический browser-сценарий/ }).click();
  await page
    .getByRole("complementary", { name: "Предпросмотр выбранной карточки" })
    .getByRole("button", { name: "Открыть карточку" })
    .click();
}

test("characterizes all five current block types and structured editor fields", async ({
  page,
  currentEditor,
}) => {
  await openSyntheticEditor(page);
  await expect(currentEditor.scenarioTable).toBeVisible();
  await expect(currentEditor.scenarioTable.locator("tbody tr")).toHaveCount(5);
  expect(
    await currentEditor.scenarioTable.locator("select").evaluateAll((items) =>
      items.map((item) => (item as HTMLSelectElement).value)
    )
  ).toEqual(["podvodka", "zk", "zk_geo", "life", "snh"]);
  await expect(currentEditor.row(0).locator("strong")).toContainText("Ведущий");
  await expect(currentEditor.row(2)).toContainText("Тестоград");
  await expect(currentEditor.row(4)).toContainText("Тестов Тест");
  await expect(currentEditor.row(4)).toContainText("Эксперт лаборатории");
  await expect(currentEditor.row(1).locator('input[value="synthetic-browser.mov"]')).toBeVisible();
  await expect(currentEditor.row(1).locator('input[value="00:01"]')).toBeVisible();
  await expect(currentEditor.row(1).locator('input[value="00:08"]')).toBeVisible();
});

test("characterizes duplicate, reorder and delete controls", async ({ page, currentEditor }) => {
  await openSyntheticEditor(page);
  await currentEditor.row(0).getByRole("button", { name: "Дублировать блок" }).click();
  await expect(currentEditor.scenarioTable.locator("tbody tr")).toHaveCount(6);
  await expect(currentEditor.scenarioTable.getByText("Ведущий открывает browser-выпуск")).toHaveCount(2);

  const duplicateEditor = currentEditor.textEditor(1);
  await duplicateEditor.click();
  await duplicateEditor.press("End");
  await duplicateEditor.type(" — копия");
  await expect(currentEditor.row(1)).toContainText("Ведущий открывает browser-выпуск — копия");

  await currentEditor.row(0).getByRole("button", { name: "Опустить блок вниз" }).click();
  await expect(currentEditor.row(0)).toContainText("Ведущий открывает browser-выпуск — копия");
  await expect(currentEditor.row(1)).toContainText("Ведущий открывает browser-выпуск");
  await expect(currentEditor.row(1)).not.toContainText("— копия");

  const lifeRow = currentEditor.scenarioTable.locator("tbody tr").filter({ hasText: "Browser-интершум" });
  await lifeRow.getByRole("button", { name: "Удалить блок" }).click();
  await expect(currentEditor.scenarioTable.getByText("Browser-интершум")).toHaveCount(0);
});
