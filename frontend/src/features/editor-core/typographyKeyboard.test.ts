import { describe, expect, it } from "vitest";

import { resolveTypographyKey, type TypographyKey } from "./typographyKeyboard";

const baseEvent: TypographyKey = {
  code: "Minus",
  key: "-",
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing: false,
};

describe("resolveTypographyKey", () => {
  it.each([
    ["numpad minus", { code: "NumpadSubtract" }, "\u2013"],
    ["Alt plus main minus", { altKey: true }, "\u2013"],
    ["Option plus main minus", { altKey: true }, "\u2013"],
    ["physical Quote producing a double quote", { code: "Quote", key: '"', shiftKey: true }, '"'],
  ] satisfies Array<[string, Partial<TypographyKey>, "\u2013" | '"']>)(
    "maps %s to the approved literal",
    (_label, patch, expected) => {
      expect(resolveTypographyKey({ ...baseEvent, ...patch })).toBe(expected);
    },
  );

  it.each([
    ["main minus", {}],
    ["Shift plus main minus", { key: "_", shiftKey: true }],
    ["Alt plus Shift plus main minus", { altKey: true, shiftKey: true }],
    ["Shift plus numpad minus", { code: "NumpadSubtract", shiftKey: true }],
    ["Alt plus numpad minus", { code: "NumpadSubtract", altKey: true }],
    ["physical Quote producing apostrophe", { code: "Quote", key: "'" }],
    ["physical Quote producing lowercase Russian e", { code: "Quote", key: "э" }],
    ["physical Quote producing uppercase Russian e", { code: "Quote", key: "Э", shiftKey: true }],
    ["Shift plus Digit2 producing double quote", { code: "Digit2", key: '"', shiftKey: true }],
    ["Shift plus Digit2 producing at sign", { code: "Digit2", key: "@", shiftKey: true }],
    ["missing physical code", { code: "", key: '"', shiftKey: true }],
    ["unidentified physical code", { code: "Unidentified", key: '"', shiftKey: true }],
    ["Ctrl plus main minus", { ctrlKey: true }],
    ["Meta plus main minus", { metaKey: true }],
    ["Alt plus composing main minus", { altKey: true, isComposing: true }],
  ] satisfies Array<[string, Partial<TypographyKey>]>)(
    "leaves %s to the browser",
    (_label, patch) => {
      expect(resolveTypographyKey({ ...baseEvent, ...patch })).toBeNull();
    },
  );

  it("leaves AltGraph input to the browser and calls the DOM method on its event", () => {
    const event: TypographyKey = {
      ...baseEvent,
      altKey: true,
      getModifierState(key) {
        expect(this).toBe(event);
        return key === "AltGraph";
      },
    };

    expect(resolveTypographyKey(event)).toBeNull();
  });

  it("resolves every repeated keydown independently", () => {
    const repeatedEvent = { ...baseEvent, code: "NumpadSubtract" };

    expect(resolveTypographyKey(repeatedEvent)).toBe("\u2013");
    expect(resolveTypographyKey(repeatedEvent)).toBe("\u2013");
  });
});
