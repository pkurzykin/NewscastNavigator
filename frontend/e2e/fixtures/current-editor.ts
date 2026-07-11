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
    return this.row(index).locator(".editor-core-content");
  }

  analyzeAccessibility() {
    return new AxeBuilder({ page: this.page }).include("#story-text").analyze();
  }
}

interface CurrentEditorFixtures {
  currentEditor: CurrentEditor;
}

export const test = base.extend<CurrentEditorFixtures>({
  currentEditor: async ({ page }, use) => {
    await use(new CurrentEditor(page));
  },
});

test("provides reusable access to the current editor", async ({
  page,
  currentEditor,
}) => {
  expect(currentEditor.page).toBe(page);
});

export { expect };
