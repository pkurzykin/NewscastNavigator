import { describe, expect, it } from "vitest";

import { describeMaterialLocation } from "./materialLocation";

describe("describeMaterialLocation", () => {
  it("trims display text and removes one matched pair of outer quotes without changing the source", () => {
    const raw = '  "C:\\Съёмка\\финал #1.mov"  ';
    expect(describeMaterialLocation(raw)).toEqual({
      display: "C:\\Съёмка\\финал #1.mov",
      href: null,
      copies: [{ label: "Копировать путь", value: "C:\\Съёмка\\финал #1.mov" }],
    });
    expect(raw).toBe('  "C:\\Съёмка\\финал #1.mov"  ');
    expect(describeMaterialLocation("  '/Volumes/Архив/файл.mov'  ").display).toBe("/Volumes/Архив/файл.mov");
    expect(describeMaterialLocation('"непарная\'').display).toBe('"непарная\'');
  });

  it("makes valid HTTP(S) links clickable and copies the displayed link", () => {
    expect(describeMaterialLocation("  https://example.test/архив/Файл #1.mov  ")).toEqual({
      display: "https://example.test/архив/Файл #1.mov",
      href: "https://example.test/%D0%B0%D1%80%D1%85%D0%B8%D0%B2/%D0%A4%D0%B0%D0%B9%D0%BB%20#1.mov",
      copies: [{ label: "Копировать ссылку", value: "https://example.test/архив/Файл #1.mov" }],
    });
    expect(describeMaterialLocation("http://example.test/a%20b").href).toBe("http://example.test/a%20b");
  });

  it.each([
    "javascript:alert(1)",
    "ftp://news/share/file.mov",
    "https://",
    "https://user:secret@example.test/file.mov",
    "https://example.test/a\nb",
  ])("never creates a clickable or network action for %s", (raw) => {
    expect(describeMaterialLocation(raw)).toEqual({
      display: raw,
      href: null,
      copies: [{ label: "Копировать путь", value: raw }],
    });
  });

  it("keeps surrounding control characters from turning into a clickable link", () => {
    expect(describeMaterialLocation("\nhttps://example.test/file.mov")).toEqual({
      display: "https://example.test/file.mov",
      href: null,
      copies: [{ label: "Копировать путь", value: "https://example.test/file.mov" }],
    });
  });

  it("converts an explicit UNC share without decoding literal percent signs", () => {
    const raw = String.raw`\\news\Общий архив\съёмка 100% #1.mov`;
    expect(describeMaterialLocation(raw)).toEqual({
      display: raw,
      href: null,
      copies: [
        { label: "Для Windows", value: raw },
        { label: "Для Linux", value: `smb://news/${encodeURIComponent("Общий архив")}/${encodeURIComponent("съёмка 100% #1.mov")}` },
      ],
    });
    expect(describeMaterialLocation(String.raw`\\news\share\file%23.mov`).copies[1].value)
      .toBe("smb://news/share/file%2523.mov");
  });

  it("decodes SMB URI path segments once for Windows and encodes them for Linux", () => {
    expect(describeMaterialLocation("smb://news/share/съёмка%20%231%25.mov")).toEqual({
      display: "smb://news/share/съёмка%20%231%25.mov",
      href: null,
      copies: [
        { label: "Для Windows", value: String.raw`\\news\share\съёмка #1%.mov` },
        { label: "Для Linux", value: `smb://news/share/${encodeURIComponent("съёмка #1%.mov")}` },
      ],
    });
    expect(describeMaterialLocation("smb://news/share/файл#1 100%.mov").copies).toEqual([
      { label: "Для Windows", value: String.raw`\\news\share\файл#1 100%.mov` },
      { label: "Для Linux", value: `smb://news/share/${encodeURIComponent("файл#1 100%.mov")}` },
    ]);
  });

  it("accepts a network file URL but keeps local file URLs local", () => {
    expect(describeMaterialLocation("file://news/share/Новый%20файл.mov").copies).toEqual([
      { label: "Для Windows", value: String.raw`\\news\share\Новый файл.mov` },
      { label: "Для Linux", value: `smb://news/share/${encodeURIComponent("Новый файл.mov")}` },
    ]);
    expect(describeMaterialLocation("file:///Volumes/Архив/файл.mov")).toEqual({
      display: "file:///Volumes/Архив/файл.mov",
      href: null,
      copies: [{ label: "Копировать путь", value: "file:///Volumes/Архив/файл.mov" }],
    });
  });

  it("preserves a trailing directory separator in shared addresses", () => {
    const unc = "\\\\news\\share\\";
    expect(describeMaterialLocation(unc).copies).toEqual([
      { label: "Для Windows", value: unc },
      { label: "Для Linux", value: "smb://news/share/" },
    ]);
    expect(describeMaterialLocation("smb://news/share/").copies).toEqual([
      { label: "Для Windows", value: unc },
      { label: "Для Linux", value: "smb://news/share/" },
    ]);
  });

  it.each([
    "/Volumes/work/share/file.mov",
    String.raw`C:\Media\file.mov`,
    "smb://news",
    "smb://user:secret@news/share/file.mov",
    "smb://news/share/%2Fsecret.mov",
    "file://localhost/share/file.mov",
    "file://user@news/share/file.mov",
    String.raw`\\news\share\bad` + "\u0000path",
    String.raw`\\..\share\file.mov`,
    "smb://news/share/\ud800",
  ])("does not guess a shared server from an unsafe or local address: %s", (raw) => {
    expect(describeMaterialLocation(raw)).toEqual({
      display: raw,
      href: null,
      copies: [{ label: "Копировать путь", value: raw }],
    });
  });

  it("treats malformed percent escapes as literal path text without losing them", () => {
    expect(describeMaterialLocation("smb://news/share/file%ZZ.mov").copies).toEqual([
      { label: "Для Windows", value: String.raw`\\news\share\file%ZZ.mov` },
      { label: "Для Linux", value: "smb://news/share/file%25ZZ.mov" },
    ]);
  });

  it("does not offer a copy action for an empty location", () => {
    expect(describeMaterialLocation("  ")).toEqual({ display: "", href: null, copies: [] });
  });
});
