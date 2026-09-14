import { useEffect, useRef, useState } from "react";
import { Alert, Autocomplete, Button, TextField } from "@mui/material";
import { removeAssignment, setAssignment } from "../api";
import type { ProductionMutationCoordinator, ProductionReadModel } from "../types";
import type { UserRef } from "../../../shared/contracts";

const kinds = ["proofreader", "video_editor", "designer"] as const;
type Kind = typeof kinds[number];
const labels: Record<Kind, string> = { proofreader: "Корректор", video_editor: "Монтажёр", designer: "Дизайнер" };
interface Choice { kind: Kind; user: UserRef | null }
interface Option { id: number | null; label: string; user: UserRef | null }
const emptyOption: Option = { id: null, label: "Без исполнителя", user: null };
const asOption = (user: UserRef): Option => ({ id: user.id, label: user.display_name.trim() || user.username, user });

export default function AssignmentPicker({ production, mutationPending, onMutate }: {
  production: ProductionReadModel;
  mutationPending: boolean;
  onMutate: ProductionMutationCoordinator;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const scope = useRef({ storyId: production.story.id, active: true });
  if (scope.current.storyId !== production.story.id) scope.current = { storyId: production.story.id, active: true };
  useEffect(() => {
    const currentScope = scope.current;
    currentScope.active = true;
    setChoice(null); setPending(false); setError(""); inFlight.current = false;
    return () => { currentScope.active = false; };
  }, [production.story.id]);

  const apply = async (next: Choice) => {
    if (inFlight.current || mutationPending || !production.can_manage_assignments) return;
    const currentScope = scope.current;
    const isCurrent = () => currentScope.active && scope.current === currentScope;
    inFlight.current = true;
    setPending(true); setChoice(next); setError("");
    try {
      await onMutate(() => next.user
        ? setAssignment(production.story.id, next.kind, next.user.id)
        : removeAssignment(production.story.id, next.kind));
      if (isCurrent()) setChoice(null);
    } catch (requestError) {
      if (isCurrent()) setError(requestError instanceof Error ? requestError.message : "Не удалось изменить исполнителя");
    } finally {
      if (isCurrent()) { inFlight.current = false; setPending(false); }
    }
  };
  return (
    <section className="production-section production-assignments" aria-labelledby="production-assignments-title">
      <header className="production-section-head">
        <div><h3 id="production-assignments-title">Исполнители</h3>
          {production.can_manage_assignments ? <p className="muted small">Выбор сохраняется сразу</p> : null}
        </div>
      </header>
      <div className="production-assignment-list">
        {kinds.map((kind) => {
          const assigned = production.assignments.find((assignment) => assignment.kind === kind)?.user;
          const selected = choice?.kind === kind ? choice.user : assigned;
          const options = production.assignee_options.filter((user) => user.function_codes.includes(kind)).map(asOption);
          const value = selected ? asOption(selected) : emptyOption;
          if (selected && !options.some((option) => option.id === selected.id)) options.unshift(value);
          return (
            <div className="production-assignment" key={kind}>
              <span className="production-assignment-label">{labels[kind]}</span>
              {production.can_manage_assignments ? (
                <Autocomplete<Option, false, true> disableClearable autoSelect={false} selectOnFocus={false}
                  value={value} options={[emptyOption, ...options]} getOptionLabel={(option) => option.label}
                  isOptionEqualToValue={(option, candidate) => option.id === candidate.id}
                  disabled={pending || mutationPending}
                  onChange={(_event, option, reason) => {
                    if (reason !== "selectOption") return;
                    if (option.id === (assigned?.id ?? null) && !error) return;
                    void apply({ kind, user: option.user });
                  }}
                  renderInput={(params) => <TextField {...params} placeholder="Найти сотрудника"
                    slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, "aria-label": `Ответственный: ${labels[kind]}` } }} />}
                />
              ) : <span className="muted">{assigned ? asOption(assigned).label : "Не назначен"}</span>}
            </div>
          );
        })}
      </div>
      {error ? <Alert severity="error" sx={{ mt: 3 }} action={<Button color="inherit" disabled={pending || mutationPending} onClick={() => { if (choice) void apply(choice); }}>Повторить назначение</Button>}>{error}</Alert> : null}
    </section>
  );
}
