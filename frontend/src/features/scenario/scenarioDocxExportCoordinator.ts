import type { MetadataValues } from "./metadataSaveCoordinator";
import type {
  ScenarioDocxDownload,
  ScenarioDocxExportRequest,
} from "./types";

export interface ExportState {
  revision: number;
  title: string;
  rubricId: number | null;
  durationText: string | null;
}

export async function prepareScenarioDocxDownload(options: {
  readOnly: boolean;
  current: () => ExportState;
  flushScenario: () => Promise<number>;
  flushMetadata: () => Promise<MetadataValues>;
  request: (payload: ScenarioDocxExportRequest) => Promise<ScenarioDocxDownload>;
}): Promise<ScenarioDocxDownload> {
  if (options.readOnly) {
    const current = options.current();
    return options.request({
      expected_revision: current.revision,
      expected_title: current.title,
      expected_rubric_id: current.rubricId,
      expected_duration_text: current.durationText,
    });
  }

  let scenarioFlush: Promise<number>;
  let metadataFlush: Promise<MetadataValues>;
  try {
    scenarioFlush = options.flushScenario();
  } catch (error) {
    scenarioFlush = Promise.reject(error);
  }
  try {
    metadataFlush = options.flushMetadata();
  } catch (error) {
    metadataFlush = Promise.reject(error);
  }
  const [revision, metadata] = await Promise.all([
    scenarioFlush,
    metadataFlush,
  ]);
  return options.request({
    expected_revision: revision,
    expected_title: metadata.title,
    expected_rubric_id: metadata.rubricId,
    expected_duration_text: metadata.durationText,
  });
}

export function triggerBrowserDownload(download: ScenarioDocxDownload): void {
  const objectUrl = URL.createObjectURL(download.blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = download.filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
