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
        title="Отменить (Cmd/Ctrl+Z)"
        disabled={disabled || !canUndo}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onUndo}
      >
        <span aria-hidden="true">↶</span>
      </button>
      <button
        type="button"
        className="secondary"
        aria-label="Повторить"
        title="Повторить (Shift+Cmd/Ctrl+Z / Ctrl+Y)"
        disabled={disabled || !canRedo}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRedo}
      >
        <span aria-hidden="true">↷</span>
      </button>
    </div>
  );
}
