import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import type { Ref } from "react";

import type { UserRef } from "../../../shared/contracts";
import type { CorrectionScope } from "../types";

export interface CorrectionPartDraft {
  key: number;
  scope: CorrectionScope;
  description: string;
  assigneeId: string;
}

interface Props {
  part: CorrectionPartDraft;
  assigneeOptions: UserRef[];
  disabled: boolean;
  scopeLocked?: boolean;
  descriptionRef?: Ref<HTMLTextAreaElement>;
  onChange: (update: Partial<CorrectionPartDraft>) => void;
}

const scopeLabels: Record<CorrectionScope, string> = {
  text: "Текст",
  video: "Ролик",
  titles: "Титры",
  voiceover: "Озвучка",
};

export default function CorrectionPartFields({
  part,
  assigneeOptions,
  disabled,
  scopeLocked = false,
  descriptionRef,
  onChange,
}: Props) {
  return (
    <div className="correction-dialog-fields">
      <div className="correction-dialog-fields-top">
        <TextField
          select
          label="Область правки"
          value={part.scope}
          disabled={disabled || scopeLocked}
          slotProps={{ select: { inputProps: { "aria-label": "Область правки" } } }}
          onChange={(event) => onChange({ scope: event.target.value as CorrectionScope })}
        >
            {Object.entries(scopeLabels).map(([value, label]) => (
              <MenuItem value={value} key={value}>{label}</MenuItem>
            ))}
        </TextField>
        <TextField
          select
          label="Ответственный"
          value={part.assigneeId}
          disabled={disabled}
          required
          slotProps={{
            inputLabel: { shrink: true },
            select: { displayEmpty: true, inputProps: { "aria-label": "Ответственный" } },
          }}
          onChange={(event) => onChange({ assigneeId: event.target.value })}
        >
            <MenuItem value=""><em>Выберите сотрудника</em></MenuItem>
            {assigneeOptions.map((option) => (
              <MenuItem value={String(option.id)} key={option.id}>
                {option.display_name} · {option.position}
              </MenuItem>
            ))}
        </TextField>
      </div>
      <TextField
        className="correction-dialog-description"
        label="Что нужно исправить"
        inputRef={descriptionRef}
        value={part.description}
        disabled={disabled}
        required
        multiline
        rows={4}
        slotProps={{ htmlInput: { maxLength: 2000, "aria-label": "Что нужно исправить" } }}
        onChange={(event) => onChange({ description: event.target.value })}
      />
    </div>
  );
}
