import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

function installMemoryLocalStorage(): void {
  let storage: Storage | undefined;
  let completeStorage = false;
  try {
    storage = window.localStorage;
    completeStorage = (
      typeof storage.length === "number"
      && typeof storage.clear === "function"
      && typeof storage.getItem === "function"
      && typeof storage.key === "function"
      && typeof storage.removeItem === "function"
      && typeof storage.setItem === "function"
    );
  } catch {
    storage = undefined;
  }
  if (completeStorage) return;
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
