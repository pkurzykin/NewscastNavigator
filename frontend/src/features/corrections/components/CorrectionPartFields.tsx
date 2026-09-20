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
        <label>
          Область правки
          <select
            value={part.scope}
            disabled={disabled || scopeLocked}
            onChange={(event) => onChange({ scope: event.target.value as CorrectionScope })}
          >
            {Object.entries(scopeLabels).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Ответственный
          <select
            value={part.assigneeId}
            disabled={disabled}
            required
            onChange={(event) => onChange({ assigneeId: event.target.value })}
          >
            <option value="">Выберите сотрудника</option>
            {assigneeOptions.map((option) => (
              <option value={option.id} key={option.id}>
                {option.display_name} · {option.position}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="correction-dialog-description">
        Что нужно исправить
        <textarea
          ref={descriptionRef}
          value={part.description}
          disabled={disabled}
          required
          rows={4}
          maxLength={2000}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </label>
    </div>
  );
}
