import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

function installMemoryLocalStorage(): void {
  if (
    typeof window.localStorage?.clear === "function"
    && typeof window.localStorage?.getItem === "function"
    && typeof window.localStorage?.setItem === "function"
  ) {
    return;
  }
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, String(value)),
    } satisfies Storage,
  });
}

beforeEach(installMemoryLocalStorage);

afterEach(() => {
  cleanup();
});
