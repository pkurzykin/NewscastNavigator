import IconButton from "@mui/material/IconButton";

import ScenarioIcon from "./ScenarioIcon";
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
      <IconButton
        type="button"
        aria-label="Отменить"
        title="Отменить (Cmd/Ctrl+Z)"
        disabled={disabled || !canUndo}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onUndo}
      >
        <ScenarioIcon name="undo" />
      </IconButton>
      <IconButton
        type="button"
        aria-label="Повторить"
        title="Повторить (Shift+Cmd/Ctrl+Z / Ctrl+Y)"
        disabled={disabled || !canRedo}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRedo}
      >
        <ScenarioIcon name="redo" />
      </IconButton>
    </div>
  );
}
