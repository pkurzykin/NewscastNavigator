import { expect, it } from "vitest";
import { createEmptyScenarioRow } from "./rowIdentity";
import { scenarioFormatting, setScenarioFormatting } from "./scenarioTableModel";

it("keeps B/I independent from inherited font and removes only an explicit font override", () => {
  const row = createEmptyScenarioRow(1);
  const bold = setScenarioFormatting(row, "text", { bold: true });
  expect(bold.formatting.targets?.text).toEqual({ bold: true });
  expect(scenarioFormatting(bold, "text", "Franklin Gothic Book").font_family).toBe("Franklin Gothic Book");
  const explicit = setScenarioFormatting(bold, "text", { font_family: "PT Sans" });
  expect(scenarioFormatting(explicit, "text", "Franklin Gothic Book").font_family).toBe("PT Sans");
  expect(setScenarioFormatting(explicit, "text", { font_family: "" }).formatting.targets?.text).toEqual({ bold: true });
});

it.each(["PT Sans", "Arial", "Georgia", "Times New Roman", "Roboto Slab", "Franklin Gothic Book"])("preserves explicit %s in both directions of the scenario default", (font) => {
  const row = setScenarioFormatting(createEmptyScenarioRow(1), "text", { font_family: font, italic: true });
  for (const base of ["PT Sans", "Franklin Gothic Book", "PT Sans"]) {
    expect(scenarioFormatting(row, "text", base)).toMatchObject({ font_family: font, italic: true });
  }
});

it.each([undefined, "", null])("inherits the default for persisted font %s without changing marks or stored data", (font) => {
  const row = createEmptyScenarioRow(1);
  // JSON is the persistence boundary: historical values may include null.
  row.formatting.targets = { text: JSON.parse(JSON.stringify({
    font_family: font, bold: true, italic: true, strikethrough: true, fill_color: "#ffeeaa",
  })) };
  const persisted = JSON.stringify(row);
  for (const base of ["Franklin Gothic Book", "PT Sans"]) {
    expect(scenarioFormatting(row, "text", base)).toEqual({
      font_family: base, bold: true, italic: true, strikethrough: true, fill_color: "#ffeeaa",
    });
  }
  expect(JSON.stringify(row)).toBe(persisted);
});
