import { describe, expect, it } from "vitest";

import playwrightConfig, { resolvePlaywrightPort } from "../../playwright.config";

describe("resolvePlaywrightPort", () => {
  it("uses the canonical port when the override is unset", () => {
    expect(resolvePlaywrightPort(undefined)).toBe("5173");
  });

  it.each(["", "abc", "5173.5", "0", "65536"])(
    "rejects invalid PLAYWRIGHT_PORT=%s",
    (value) => {
      expect(() => resolvePlaywrightPort(value)).toThrow("PLAYWRIGHT_PORT");
    },
  );

  it("accepts a valid TCP port", () => {
    expect(resolvePlaywrightPort("5174")).toBe("5174");
  });

  it("runs the wide layout contract only in its dedicated project", () => {
    const projects = playwrightConfig.projects ?? [];
    const wideProject = projects.find((project) => project.name === "chromium-2560-layout");
    const mainProjects = projects.filter((project) => project.name !== "chromium-2560-layout");

    expect(wideProject?.testMatch).toEqual(["**/layout-wide.spec.ts"]);
    expect(mainProjects).toHaveLength(2);
    for (const project of mainProjects) {
      expect(project.testIgnore).toContain("**/layout-wide.spec.ts");
    }
  });

  it("starts ordinary authenticated scenarios after the current release note was seen", () => {
    expect(playwrightConfig.use?.storageState).toEqual({
      cookies: [],
      origins: [
        {
          origin: "http://127.0.0.1:5173",
          localStorage: [1, 2, 3, 4].map((userId) => ({
            name: `newscast:whats-new:${userId}:1.3.0`,
            value: "seen",
          })),
        },
      ],
    });
  });
});
