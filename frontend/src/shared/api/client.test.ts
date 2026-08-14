import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiRequest, apiResponse } from "./client";
import { exportScenarioDocx } from "../../features/scenario/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function readBlobBytes(blob: Blob): Promise<number[]> {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

describe("apiResponse", () => {
  it("uses cookie credentials and omits JSON content type when the request has no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await apiResponse("/api/v1/download", {
      headers: { Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    });

    expect(response.status).toBe(204);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("Accept")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });

  it("adds JSON content type only when a request body exists", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiResponse("/api/v1/first", { method: "POST", body: "{}" });
    await apiResponse("/api/v1/second", {
      method: "POST",
      body: "binary",
      headers: { "Content-Type": "application/octet-stream" },
    });

    const firstHeaders = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    const secondHeaders = new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers);
    expect(firstHeaders.get("Content-Type")).toBe("application/json");
    expect(secondHeaders.get("Content-Type")).toBe("application/octet-stream");
  });

  it("returns the real binary response without invoking json on success", async () => {
    const serverResponse = new Response(new Uint8Array([80, 75, 3, 4]), {
      status: 200,
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    });
    const jsonSpy = vi.spyOn(serverResponse, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(serverResponse));

    const response = await apiResponse("/api/v1/stories/101/scenario/export-docx");

    expect(response).toBe(serverResponse);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([80, 75, 3, 4]);
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("turns a JSON error envelope into ApiError with status, code and message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "SCENARIO_EXPORT_STALE",
        message: "Сценарий изменился",
        details: { current_revision: 9 },
      },
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    })));

    const failure = await apiResponse("/api/v1/stories/101/scenario/export-docx")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 409,
      code: "SCENARIO_EXPORT_STALE",
      message: "Сценарий изменился",
    });
  });

  it("uses the generic API error when an error response is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gateway failure", {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    })));

    const failure = await apiResponse("/api/v1/stories/101/scenario/export-docx")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 502, message: "Ошибка запроса к API" });
  });
});

describe("apiRequest", () => {
  it("keeps parsing the successful JSON response contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      revision: 12,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const payload = await apiRequest<{ ok: true; revision: number }>(
      "/api/v1/stories/101/scenario",
    );

    expect(payload).toEqual({ ok: true, revision: 12 });
  });

  it("keeps the previous null fallback when a successful JSON body cannot be parsed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const payload = await apiRequest<unknown>("/api/v1/stories/101/scenario");

    expect(payload).toBeNull();
  });
});

describe("exportScenarioDocx", () => {
  it("posts the exact expectation and returns the DOCX blob with decoded UTF-8 filename", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([80, 75, 3, 4]), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": "attachment; filename=\"Scenario-101.docx\"; filename*=UTF-8''%D0%92%D0%B5%D1%87%D0%B5%D1%80%D0%BD%D0%B8%D0%B5-%D0%BD%D0%BE%D0%B2%D0%BE%D1%81%D1%82%D0%B8.docx",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const download = await exportScenarioDocx(101, {
      expected_revision: 7,
      expected_title: "Вечерние новости",
      expected_rubric_id: 3,
      expected_duration_text: "03:45",
    });

    expect(download.filename).toBe("Вечерние-новости.docx");
    expect(download.blob.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(await readBlobBytes(download.blob)).toEqual([80, 75, 3, 4]);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/stories/101/scenario/export-docx");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      expected_revision: 7,
      expected_title: "Вечерние новости",
      expected_rubric_id: 3,
      expected_duration_text: "03:45",
    });
  });

  it("falls back to Scenario-id.docx when filename star is absent or malformed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "Content-Disposition": "attachment; filename=\"server-choice.docx\"" },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([2]), {
        status: 200,
        headers: { "Content-Disposition": "attachment; filename*=UTF-8''%ZZ.docx" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const expectation = {
      expected_revision: 8,
      expected_title: "Новости",
      expected_rubric_id: null,
      expected_duration_text: null,
    };

    const missing = await exportScenarioDocx(202, expectation);
    const malformed = await exportScenarioDocx(303, expectation);

    expect(missing.filename).toBe("Scenario-202.docx");
    expect(malformed.filename).toBe("Scenario-303.docx");
  });
});
