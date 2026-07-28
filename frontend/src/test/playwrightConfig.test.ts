import { describe, expect, it } from "vitest";

import { resolvePlaywrightPort } from "../../playwright.config";

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
});
