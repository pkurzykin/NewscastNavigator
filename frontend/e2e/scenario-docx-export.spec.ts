import { expect, test, type Download, type Page } from "@playwright/test";

const syntheticUser = {
  id: 1,
  username: "synthetic_author",
  display_name: "Тест",
  position: "Корреспондент",
  function_codes: ["author"],
  is_active: true,
  must_change_password: false,
  created_at: "2026-08-06T00:00:00Z",
};

const syntheticStory = {
  id: 101,
  title: "Синтетический сценарий с очень длинным названием для проверки переноса в синей шапке и отсутствия горизонтального переполнения рабочего экрана",
  duration_text: "12 минут 30 секунд",
  priority: { code: "standard", label: "Стандарт" },
  rubric: { id: 7, name: "Тестовая рубрика" },
  author: syntheticUser,
  situation: { code: "active", label: "В работе" },
  assignments: [],
  created_at: "2026-08-06T00:00:00Z",
  archived_at: null,
};

const syntheticWorkflow = {
  story_id: 101,
  review_request: null,
  editorial_check: null,
  proofread: null,
  changed_after_proofread: false,
  reproofread_request: null,
  primary_action: null,
  additional_actions: [],
};

function syntheticRow(id: number, blockType: string, text: string) {
  return {
    segment_uid: `seg_export_${id}`,
    order_index: id,
    block_type: blockType,
    text,
    speaker_text: blockType === "snh" ? "Тестовый спикер\nСинтетическая должность" : "",
    file_name: blockType === "zk" ? "synthetic.mov" : "",
    tc_in: blockType === "zk" ? "00:01" : "",
    tc_out: blockType === "zk" ? "00:05" : "",
    additional_comment: "",
    structured_data: {},
    formatting: {},
    rich_text: {
      schema_version: 1,
      targets: {
        text: { editor: "tiptap", text, html: text },
      },
    },
  };
}

const syntheticRows = [
  syntheticRow(1, "podvodka", "Синтетическая подводка"),
  syntheticRow(2, "zk", "Синтетический закадровый текст"),
  syntheticRow(3, "zk_geo", "Синтетический текст с географией"),
  syntheticRow(4, "life", "Синтетический лайф"),
  syntheticRow(5, "snh", "Синтетическая реплика"),
];

const syntheticDocx = Buffer.from(
  "UEsDBBQAAAAAADuDBl3MVIwQnAEAAJwBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04Ij8+PFR5cGVzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L2NvbnRlbnQtdHlwZXMiPjxEZWZhdWx0IEV4dGVuc2lvbj0icmVscyIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1wYWNrYWdlLnJlbGF0aW9uc2hpcHMreG1sIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJ4bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi94bWwiLz48T3ZlcnJpZGUgUGFydE5hbWU9Ii93b3JkL2RvY3VtZW50LnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC53b3JkcHJvY2Vzc2luZ21sLmRvY3VtZW50Lm1haW4reG1sIi8+PC9UeXBlcz5QSwMEFAAAAAAAO4MGXTZX3twYAQAAGAEAAAsAAABfcmVscy8ucmVsczw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04Ij8+PFJlbGF0aW9uc2hpcHMgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9wYWNrYWdlLzIwMDYvcmVsYXRpb25zaGlwcyI+PFJlbGF0aW9uc2hpcCBJZD0icklkMSIgVHlwZT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcy9vZmZpY2VEb2N1bWVudCIgVGFyZ2V0PSJ3b3JkL2RvY3VtZW50LnhtbCIvPjwvUmVsYXRpb25zaGlwcz5QSwMEFAAAAAAAO4MGXWd7ISHiAAAA4gAAABEAAAB3b3JkL2RvY3VtZW50LnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04Ij8+PHc6ZG9jdW1lbnQgeG1sbnM6dz0iaHR0cDovL3NjaGVtYXMub3JnL3dvcmRwcm9jZXNzaW5nbWwvMjAwNi9tYWluIj48dzpib2R5Pjx3OnA+PHc6cj48dzp0PtCh0LjQvdGC0LXRgtC40YfQtdGB0LrQuNC5IERPQ1g8L3c6dD48L3c6cj48L3c6cD48dzpzZWN0UHIvPjwvdzpib2R5Pjwvdzpkb2N1bWVudD5QSwECFAMUAAAAAAA7gwZdzFSMEJwBAACcAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAAADuDBl02V97cGAEAABgBAAALAAAAAAAAAAAAAACAAc0BAABfcmVscy8ucmVsc1BLAQIUAxQAAAAAADuDBl1neyEh4gAAAOIAAAARAAAAAAAAAAAAAACAAQ4DAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAAAfBAAAAAA=",
  "base64",
);

interface NetworkRecord {
  mutations: string[];
  scenarioPayloads: Array<Record<string, unknown>>;
  metadataPayloads: Array<Record<string, unknown>>;
  exportPayloads: Array<Record<string, unknown>>;
  acknowledgeScenario: () => void;
  acknowledgeMetadata: () => void;
}

async function installSyntheticApi(
  page: Page,
  options: {
    editState?: "available" | "held" | "archived";
    exportError?: boolean;
    deferFlushes?: boolean;
  } = {},
): Promise<NetworkRecord> {
  let acknowledgeScenario = () => undefined;
  let acknowledgeMetadata = () => undefined;
  const scenarioAcknowledgement = new Promise<void>((resolve) => {
    acknowledgeScenario = resolve;
  });
  const metadataAcknowledgement = new Promise<void>((resolve) => {
    acknowledgeMetadata = resolve;
  });
  const record: NetworkRecord = {
    mutations: [],
    scenarioPayloads: [],
    metadataPayloads: [],
    exportPayloads: [],
    acknowledgeScenario,
    acknowledgeMetadata,
  };
  await page.context().addCookies([{
    name: "newscast_session",
    value: "synthetic-session",
    url: "http://127.0.0.1:5173",
  }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/me") return route.fulfill({ json: syntheticUser });
    if (path === "/api/v1/me/actions") {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    if (path === "/api/v1/notifications") {
      return route.fulfill({ json: { items: [], total: 0, unread_count: 0 } });
    }
    if (path === "/api/v1/stories/101") return route.fulfill({ json: syntheticStory });
    if (path === "/api/v1/stories/101/workflow") {
      return route.fulfill({ json: syntheticWorkflow });
    }
    if (path === "/api/v1/stories/101/scenario" && request.method() === "GET") {
      return route.fulfill({
        json: {
          story: syntheticStory,
          scenario: { revision: 3, rows: syntheticRows },
          edit: { state: options.editState ?? "available" },
          metadata: {
            editable: true,
            rubrics: [
              { id: 1, name: "Новости" },
              { id: 7, name: "Тестовая рубрика" },
            ],
          },
          captionpanels: {
            eligible: true,
            last_opened_revision: null,
            changed_since_last_open: false,
            diff_session_id: null,
          },
        },
      });
    }
    if (path === "/api/v1/stories/101/scenario/lease" && request.method() === "POST") {
      return route.fulfill({
        json: {
          edit_session_id: 5,
          lease_token: "synthetic-lease",
          expires_at: "2099-08-06T12:00:00Z",
          revision: 3,
        },
      });
    }
    if (path === "/api/v1/stories/101/scenario/lease" && request.method() === "DELETE") {
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/v1/stories/101/scenario" && request.method() === "PUT") {
      record.mutations.push("PUT scenario");
      const payload = request.postDataJSON() as Record<string, unknown>;
      record.scenarioPayloads.push(payload);
      if (options.deferFlushes) await scenarioAcknowledgement;
      return route.fulfill({
        json: {
          ok: true,
          client_save_id: payload.client_save_id,
          revision: 4,
          saved_at: "2026-08-06T12:00:00Z",
        },
      });
    }
    if (path === "/api/v1/stories/101/metadata" && request.method() === "PATCH") {
      record.mutations.push("PATCH metadata");
      record.metadataPayloads.push(request.postDataJSON() as Record<string, unknown>);
      if (options.deferFlushes) await metadataAcknowledgement;
      return route.fulfill({
        json: {
          ok: true,
          event_id: null,
          changed_at: "2026-08-06T12:00:00Z",
          resource: { type: "story", id: 101 },
        },
      });
    }
    if (path === "/api/v1/stories/101/scenario/export-docx" && request.method() === "POST") {
      record.mutations.push("POST export-docx");
      record.exportPayloads.push(request.postDataJSON() as Record<string, unknown>);
      if (options.exportError) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "SCENARIO_EXPORT_EXPECTATION_MISMATCH",
              message: "Снимок сценария уже изменился",
              details: {},
            },
          },
        });
      }
      return route.fulfill({
        status: 200,
        body: syntheticDocx,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": "attachment; filename*=UTF-8''synthetic-scenario.docx",
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: {
        error: {
          code: "SYNTHETIC_ROUTE_MISSING",
          message: `Unexpected synthetic route: ${request.method()} ${path}`,
          details: {},
        },
      },
    });
  });
  return record;
}

async function downloadedBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("flushes immediate edits before one sticky DOCX download", async ({ page }) => {
  const record = await installSyntheticApi(page, { deferFlushes: true });
  let downloadCount = 0;
  page.on("download", () => { downloadCount += 1; });
  await page.goto("/stories/101/scenario");

  const metadata = page.getByRole("group", { name: "Шапка таблицы сценария" });
  await expect(metadata.getByRole("textbox", { name: "Название" }))
    .toHaveValue(syntheticStory.title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
  await expect(page.getByRole("toolbar", { name: "Форматирование" })).toHaveCount(1);
  const exportButton = page.getByRole("button", { name: "Экспорт DOCX" });
  await expect(exportButton).toBeVisible();

  await page.evaluate(() => {
    const runway = document.createElement("div");
    runway.setAttribute("aria-hidden", "true");
    runway.style.height = "900px";
    const editor = document.querySelector(".scenario-editor");
    if (!editor) throw new Error("Scenario editor is not mounted");
    editor.appendChild(runway);
    window.scrollTo(0, 700);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(650);
  const headerBox = await page.locator(".app-shell-header").boundingBox();
  const buttonBox = await exportButton.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);

  const firstEditor = page.getByRole("textbox", { name: "Текст блока 1" });
  await firstEditor.click();
  await firstEditor.press("End");
  await firstEditor.type(" — свежая browser-правка");
  await metadata.getByRole("textbox", { name: "Хронометраж" }).fill("02:45");
  await expect.poll(() => page.evaluate(async () => {
    const before = window.scrollY;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return window.scrollY === before;
  })).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);
  const scrollBeforeExport = await page.evaluate(() => window.scrollY);
  await expect(exportButton).toBeInViewport();

  const downloadPromise = page.waitForEvent("download");
  const exportButtonBox = await exportButton.boundingBox();
  expect(exportButtonBox).not.toBeNull();
  await page.mouse.click(
    exportButtonBox!.x + exportButtonBox!.width / 2,
    exportButtonBox!.y + exportButtonBox!.height / 2,
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBeforeExport);
  await expect.poll(() => record.mutations).toHaveLength(2);
  expect([...record.mutations].sort()).toEqual([
    "PATCH metadata",
    "PUT scenario",
  ]);
  expect(record.mutations).not.toContain("POST export-docx");

  record.acknowledgeScenario();
  await page.waitForTimeout(50);
  expect(record.mutations).not.toContain("POST export-docx");
  record.acknowledgeMetadata();
  const download = await downloadPromise;
  await expect(exportButton).toHaveText("Экспорт DOCX");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBeforeExport);

  expect(record.mutations.slice(0, 2).sort()).toEqual([
    "PATCH metadata",
    "PUT scenario",
  ]);
  expect(record.mutations.at(-1)).toBe("POST export-docx");
  expect(record.scenarioPayloads).toHaveLength(1);
  expect(record.scenarioPayloads[0].base_revision).toBe(3);
  const savedRows = record.scenarioPayloads[0].rows as Array<Record<string, unknown>>;
  expect(savedRows).toHaveLength(5);
  expect(savedRows[0]).toMatchObject({
    text: "Синтетическая подводка — свежая browser-правка",
  });
  expect(record.metadataPayloads).toEqual([{ duration_text: "02:45" }]);
  expect(record.exportPayloads).toEqual([{
    expected_revision: 4,
    expected_title: syntheticStory.title,
    expected_rubric_id: 7,
    expected_duration_text: "02:45",
  }]);
  await page.waitForTimeout(100);
  expect(downloadCount).toBe(1);
  expect(download.suggestedFilename()).toBe("synthetic-scenario.docx");
  const bytes = await downloadedBytes(download);
  expect(bytes.length).toBeGreaterThan(0);
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));
});

test("exports an archived canonical scenario without save requests", async ({ page }) => {
  const record = await installSyntheticApi(page, { editState: "archived" });
  let downloadCount = 0;
  page.on("download", () => { downloadCount += 1; });
  await page.goto("/stories/101/scenario");

  await expect(page.getByRole("button", { name: "Экспорт DOCX" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Форматирование" })).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Экспорт DOCX" }).click();
  const download = await downloadPromise;

  expect(record.mutations).toEqual(["POST export-docx"]);
  expect(record.exportPayloads).toEqual([{
    expected_revision: 3,
    expected_title: syntheticStory.title,
    expected_rubric_id: 7,
    expected_duration_text: "12 минут 30 секунд",
  }]);
  expect(download.suggestedFilename()).toBe("synthetic-scenario.docx");
  expect(downloadCount).toBe(1);
});

test("shows a Russian export error and creates no download", async ({ page }) => {
  const record = await installSyntheticApi(page, { exportError: true });
  let downloadCount = 0;
  page.on("download", () => { downloadCount += 1; });
  await page.goto("/stories/101/scenario");

  await page.getByRole("button", { name: "Экспорт DOCX" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Не удалось экспортировать DOCX. Снимок сценария уже изменился",
  );
  await page.waitForTimeout(100);

  expect(record.mutations).toEqual(["POST export-docx"]);
  expect(downloadCount).toBe(0);
});
