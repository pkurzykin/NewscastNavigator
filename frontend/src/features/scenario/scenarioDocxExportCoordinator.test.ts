import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeferred } from "../../test/deferred";
import type { MetadataValues } from "./metadataSaveCoordinator";
import {
  prepareScenarioDocxDownload,
  triggerBrowserDownload,
  type ExportState,
} from "./scenarioDocxExportCoordinator";
import type {
  ScenarioDocxDownload,
  ScenarioDocxExportRequest,
} from "./types";

const download: ScenarioDocxDownload = {
  blob: new Blob(["synthetic-docx"], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }),
  filename: "synthetic-scenario.docx",
};

const staleState: ExportState = {
  revision: 4,
  title: "Старое название",
  rubricId: 2,
  durationText: "00:20",
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("prepareScenarioDocxDownload", () => {
  it("starts both editable flushes before either acknowledgement and exports their persisted values", async () => {
    const events: string[] = [];
    const scenarioFlush = createDeferred<number>();
    const metadataFlush = createDeferred<MetadataValues>();
    const requests: ScenarioDocxExportRequest[] = [];

    const prepared = prepareScenarioDocxDownload({
      readOnly: false,
      current: () => staleState,
      flushScenario: () => {
        events.push("flush-scenario:start");
        return scenarioFlush.promise.then((revision) => {
          events.push("flush-scenario:ack");
          return revision;
        });
      },
      flushMetadata: () => {
        events.push("flush-metadata:start");
        return metadataFlush.promise.then((metadata) => {
          events.push("flush-metadata:ack");
          return metadata;
        });
      },
      request: async (payload) => {
        events.push("export-request");
        requests.push(payload);
        return download;
      },
    });

    expect(events).toEqual([
      "flush-scenario:start",
      "flush-metadata:start",
    ]);

    scenarioFlush.resolve(8);
    await scenarioFlush.promise;
    await Promise.resolve();
    expect(events).toEqual([
      "flush-scenario:start",
      "flush-metadata:start",
      "flush-scenario:ack",
    ]);

    metadataFlush.resolve({
      title: "Подтверждённое название",
      rubricId: 7,
      durationText: "01:35",
    });

    await expect(prepared).resolves.toBe(download);
    expect(events).toEqual([
      "flush-scenario:start",
      "flush-metadata:start",
      "flush-scenario:ack",
      "flush-metadata:ack",
      "export-request",
    ]);
    expect(requests).toEqual([{
      expected_revision: 8,
      expected_title: "Подтверждённое название",
      expected_rubric_id: 7,
      expected_duration_text: "01:35",
    }]);
  });

  it.each([
    ["held active scenario", {
      revision: 12,
      title: "Сценарий занят редактором",
      rubricId: 3,
      durationText: null,
    }],
    ["archived scenario", {
      revision: 19,
      title: "Архивный сценарий",
      rubricId: null,
      durationText: "03:10",
    }],
  ] satisfies [string, ExportState][]) (
    "exports the canonical loaded state without either flush for a read-only %s",
    async (_label, canonicalState) => {
      const flushScenario = vi.fn<() => Promise<number>>();
      const flushMetadata = vi.fn<() => Promise<MetadataValues>>();
      const request = vi.fn(async () => download);

      await expect(prepareScenarioDocxDownload({
        readOnly: true,
        current: () => canonicalState,
        flushScenario,
        flushMetadata,
        request,
      })).resolves.toBe(download);

      expect(flushScenario).not.toHaveBeenCalled();
      expect(flushMetadata).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledWith({
        expected_revision: canonicalState.revision,
        expected_title: canonicalState.title,
        expected_rubric_id: canonicalState.rubricId,
        expected_duration_text: canonicalState.durationText,
      });
    },
  );

  it.each(["scenario", "metadata"] as const)(
    "fails closed when the %s flush rejects",
    async (rejectedFlush) => {
      const failure = new Error(`${rejectedFlush} flush failed`);
      const request = vi.fn(async () => download);
      const flushScenario = vi.fn(() => rejectedFlush === "scenario"
        ? Promise.reject(failure)
        : Promise.resolve(9));
      const flushMetadata = vi.fn(() => rejectedFlush === "metadata"
        ? Promise.reject(failure)
        : Promise.resolve({
          title: "Подтверждённое название",
          rubricId: 7,
          durationText: "01:35",
        }));

      await expect(prepareScenarioDocxDownload({
        readOnly: false,
        current: () => staleState,
        flushScenario,
        flushMetadata,
        request,
      })).rejects.toBe(failure);

      expect(flushScenario).toHaveBeenCalledOnce();
      expect(flushMetadata).toHaveBeenCalledOnce();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("does not trigger a browser download when the export request rejects", async () => {
    const failure = new Error("export request failed");
    const createObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    const attempt = prepareScenarioDocxDownload({
      readOnly: true,
      current: () => staleState,
      flushScenario: vi.fn(),
      flushMetadata: vi.fn(),
      request: vi.fn().mockRejectedValue(failure),
    }).then(triggerBrowserDownload);

    await expect(attempt).rejects.toBe(failure);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});

describe("triggerBrowserDownload", () => {
  it("removes the anchor immediately and revokes the object URL in a later task", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      events.push("create-object-url");
      expect(blob).toBe(download.blob);
      return "blob:synthetic-docx";
    });
    const revokeObjectURL = vi.fn((url: string) => {
      events.push("revoke-object-url");
      expect(url).toBe("blob:synthetic-docx");
    });
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    const nativeRemove = Element.prototype.remove;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function clickAnchor(this: HTMLAnchorElement) {
        events.push("anchor-click");
        expect(this.isConnected).toBe(true);
        expect(this.href).toBe("blob:synthetic-docx");
        expect(this.download).toBe("synthetic-scenario.docx");
      });
    const remove = vi.spyOn(HTMLAnchorElement.prototype, "remove")
      .mockImplementation(function removeAnchor(this: HTMLAnchorElement) {
        events.push("anchor-remove");
        nativeRemove.call(this);
      });

    triggerBrowserDownload(download);

    expect(events).toEqual([
      "create-object-url",
      "anchor-click",
      "anchor-remove",
    ]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(events).toEqual([
      "create-object-url",
      "anchor-click",
      "anchor-remove",
      "revoke-object-url",
    ]);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('a[download="synthetic-scenario.docx"]')).toHaveLength(0);
  });
});
