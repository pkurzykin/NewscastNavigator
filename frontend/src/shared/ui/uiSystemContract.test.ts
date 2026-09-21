import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const srcRoot = join(process.cwd(), "src");
const stylesRoot = join(srcRoot, "styles");

function filesBelow(root: string, extension: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory()
      ? filesBelow(path, extension)
      : extname(path) === extension
        ? [path]
        : [];
  });
}

function runtimeTsxFiles(): string[] {
  return filesBelow(srcRoot, ".tsx").filter((path) => !path.endsWith(".test.tsx"));
}

function runtimeSourceFiles(): string[] {
  return [
    ...filesBelow(srcRoot, ".ts").filter((path) => !path.endsWith(".test.ts")),
    ...runtimeTsxFiles(),
  ];
}

const nativeScenarioAllowlist = [
  "features/scenario/AccessNativeField.tsx",
  "features/scenario/components/ScenarioEditor.tsx",
  "features/scenario/components/ScenarioMetadataHeader.tsx",
  "features/scenario/components/ScenarioRow.tsx",
];

describe("единый контракт дизайн-системы", () => {
  it("не допускает самодельные диалоги и старые variant-классы", () => {
    const violations = runtimeTsxFiles().flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const file = relative(srcRoot, path);
      const dialogViolations = [...source.matchAll(/<dialog\b|role=["']dialog["']/g)]
        .map((match) => `${file}: ${match[0]}`);
      const variantViolations = [...source.matchAll(/className=["']([^"']+)["']/g)]
        .flatMap((match) => match[1].split(/\s+/))
        .filter((className) => ["primary", "secondary", "danger", "text-button"].includes(className))
        .map((className) => `${file}: .${className}`);
      const nativeSelectViolations = [...source.matchAll(/native\s*:\s*true/g)]
        .map((match) => `${file}: ${match[0]}`);
      return [...dialogViolations, ...variantViolations, ...nativeSelectViolations];
    });

    expect(violations).toEqual([]);
    expect(existsSync(join(srcRoot, "features/stories/components/ActionButton.tsx"))).toBe(false);
  });

  it("не показывает browser-native confirm, alert или prompt", () => {
    const violations = runtimeSourceFiles().flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const file = relative(srcRoot, path);
      return [...source.matchAll(/(?:window\.|globalThis\.)?(?:confirm|alert|prompt)\s*\(/g)]
        .map((match) => `${file}: ${match[0]}`);
    });

    expect(violations).toEqual([]);
  });

  it("оставляет native controls только внутри сценарного редактора", () => {
    const violations = runtimeTsxFiles().flatMap((path) => {
      const file = relative(srcRoot, path);
      if (nativeScenarioAllowlist.includes(file)) return [];
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(/<(?:button|input|select|textarea)\b/g)]
        .map((match) => `${file}: ${match[0]}`);
    });

    expect(violations).toEqual([]);
  });

  it("хранит цвета в tokens.css и не имитирует компоненты в base.css", () => {
    const cssFiles = filesBelow(stylesRoot, ".css");
    const literalColorViolations = cssFiles.flatMap((path) => {
      if (path.endsWith("tokens.css")) return [];
      const source = readFileSync(path, "utf8");
      const file = relative(srcRoot, path);
      return [...source.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(/gi)]
        .map((match) => `${file}: ${match[0]}`);
    });
    const base = readFileSync(join(stylesRoot, "base.css"), "utf8");

    expect(literalColorViolations).toEqual([]);
    expect(base).not.toMatch(/button\.(?:primary|secondary|danger|text-button)/);
    expect(base).not.toMatch(/button:where\(\:not\(\.MuiButtonBase-root\)/);
    expect(base).not.toMatch(/input:where\(\:not\(\.MuiInputBase-input\)/);
  });
});
