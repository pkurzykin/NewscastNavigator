import type { ScenarioCaptionPanelsState } from "../types";


interface CaptionPanelsStatusProps {
  storyId: number;
  state: ScenarioCaptionPanelsState;
}


export default function CaptionPanelsStatus({ storyId, state }: CaptionPanelsStatusProps) {
  return (
    <section className="captionpanels-status" aria-labelledby="captionpanels-status-title">
      <div>
        <h3 id="captionpanels-status-title">CaptionPanels</h3>
        <p className="muted">
          CaptionPanels при каждом открытии получает актуальный сценарий с сервера. Уже открытый проект
          After Effects не обновляется автоматически.
        </p>
      </div>
      {!state.eligible ? (
        <p className="muted">Открытие CaptionPanels сейчас недоступно.</p>
      ) : state.changed_since_last_open ? (
        <p className="captionpanels-warning" role="alert">
          Сценарий изменился после последнего открытия CaptionPanels. В After Effects изменения нужно
          загрузить явным открытием.
          {state.diff_session_id !== null ? (
            <> <a href={`/stories/${storyId}/history?session=${state.diff_session_id}`}>Посмотреть изменения</a>.</>
          ) : null}
        </p>
      ) : (
        <p className="captionpanels-state">
          {state.last_opened_revision === null
            ? "CaptionPanels для этого сюжета ещё не открывался."
            : `Последнее открытие: редакция ${state.last_opened_revision}.`}
        </p>
      )}
    </section>
  );
}
