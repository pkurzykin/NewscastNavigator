import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test as base,
  type Locator,
  type Page,
} from "@playwright/test";

export class CurrentEditor {
  readonly page: Page;
  readonly scenarioTable: Locator;

  constructor(page: Page) {
    this.page = page;
    this.scenarioTable = page.getByRole("region", { name: "Таблица сценария" });
  }

  row(index: number): Locator {
    return this.scenarioTable.locator("tbody tr").nth(index);
  }

  textEditor(index: number): Locator {
    return this.row(index).getByRole("textbox", { name: /^Текст блока \d+$/ });
  }

  analyzeAccessibility() {
    return new AxeBuilder({ page: this.page }).include("#story-text").analyze();
  }
}

interface CurrentEditorFixtures {
  accessReadModel: void;
  currentEditor: CurrentEditor;
}

export const test = base.extend<CurrentEditorFixtures>({
  // Existing synthetic scenarios share the additive read-only access projection.
  // Dedicated access tests use a server-state fixture to exercise contention.
  accessReadModel: [async ({ page }, use) => {
    const states = new Map<number, { revision: number; edit: Record<string, unknown> }>();
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) states.clear(); });
    page.on("response", async (response) => {
      const path = new URL(response.url()).pathname;
      const match = path.match(/\/stories\/(\d+)\/scenario(?:\/lease)?$/);
      if (!match || !response.ok()) return;
      const id = Number(match[1]);
      try {
        const body = await response.json();
        if (path.endsWith("/scenario") && response.request().method() === "GET") states.set(id, { revision: body.scenario.revision, edit: body.edit });
        if (path.endsWith("/lease") && response.request().method() === "POST") states.set(id, { revision: body.revision, edit: { state: "mine", edit_session_id: body.edit_session_id, expires_at: body.expires_at } });
        if (path.endsWith("/lease") && response.request().method() === "DELETE") states.set(id, { revision: states.get(id)?.revision ?? 0, edit: { state: "available" } });
      } catch { /* A deliberately failed/closed transport has no accepted projection. */ }
    });
    await page.route("**/scenario/access", (route) => {
      const id = Number(new URL(route.request().url()).pathname.match(/stories\/(\d+)/)?.[1]);
      return route.fulfill({ json: { story_id: id, ...(states.get(id) ?? { revision: 0, edit: { state: "available" } }) } });
    });
    await use();
  }, { auto: true }],
  currentEditor: async ({ page }, use) => {
    await use(new CurrentEditor(page));
  },
});

export { expect };
