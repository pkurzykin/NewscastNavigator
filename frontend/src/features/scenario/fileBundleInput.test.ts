import { describe, expect, it } from "vitest";

import {
  isFileBundlePlusKey,
  replaceInputSelection,
} from "./fileBundleInput";

describe("file bundle input", () => {
  it("recognizes hardware plus keys without composing input", () => {
    expect(isFileBundlePlusKey({ code: "Equal", key: "+", shiftKey: true, isComposing: false })).toBe(true);
    expect(isFileBundlePlusKey({ code: "NumpadAdd", key: "+", shiftKey: false, isComposing: false })).toBe(true);
    expect(isFileBundlePlusKey({ code: "Equal", key: "=", shiftKey: false, isComposing: false })).toBe(false);
    expect(isFileBundlePlusKey({ code: "Equal", key: "+", shiftKey: true, isComposing: true })).toBe(false);
  });

  it("replaces the current input selection and returns the next caret", () => {
    expect(replaceInputSelection("AB", 1, 1, "+")).toEqual({ value: "A+B", caret: 2 });
    expect(replaceInputSelection("A=B", 1, 2, "+")).toEqual({ value: "A+B", caret: 2 });
  });
});
