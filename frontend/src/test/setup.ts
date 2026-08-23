import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

function installMemoryLocalStorage(): void {
  // Keep unit tests deterministic across Node/jsdom versions. WebIDL Storage
  // methods live on the prototype in some environments, where spying on the
  // instance does not intercept calls. Browser semantics remain covered by E2E.
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(String(key)) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => {
        values.delete(String(key));
      },
      setItem: (key: string, value: string) => {
        values.set(String(key), String(value));
      },
    } satisfies Storage,
  });
}

beforeEach(installMemoryLocalStorage);

afterEach(() => {
  cleanup();
});
