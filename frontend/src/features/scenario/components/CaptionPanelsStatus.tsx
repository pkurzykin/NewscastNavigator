import type { ScenarioCaptionPanelsState } from "../types";


interface CaptionPanelsStatusProps {
  storyId: number;
  state: ScenarioCaptionPanelsState;
}


export default function CaptionPanelsStatus({ storyId, state }: CaptionPanelsStatusProps) {
  if (!state.eligible || !state.changed_since_last_open) {
    return null;
  }

  return (
    <p className="captionpanels-warning captionpanels-warning-compact" role="alert">
      CaptionPanels: сценарий изменился после последнего открытия.
      {state.diff_session_id !== null ? (
        <> <a href={`/stories/${storyId}/history?session=${state.diff_session_id}`}>Посмотреть изменения</a>.</>
      ) : null}
    </p>
  );
}
