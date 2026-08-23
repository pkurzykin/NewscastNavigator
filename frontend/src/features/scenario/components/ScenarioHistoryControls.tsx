interface Props {
  canUndo: boolean;
  canRedo: boolean;
  disabled?: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export default function ScenarioHistoryControls({
  canUndo,
  canRedo,
  disabled = false,
  onUndo,
  onRedo,
}: Props) {
  return (
    <div className="scenario-history-controls" role="group" aria-label="История изменений">
      <button
        type="button"
        className="secondary"
        aria-label="Отменить"
        title="Отменить"
        disabled={disabled || !canUndo}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onUndo}
      >
        Отменить
      </button>
      <button
        type="button"
        className="secondary"
        aria-label="Повторить"
        title="Повторить"
        disabled={disabled || !canRedo}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRedo}
      >
        Повторить
      </button>
    </div>
  );
}
