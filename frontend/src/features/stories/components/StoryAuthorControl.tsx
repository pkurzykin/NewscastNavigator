import { useEffect, useRef, useState } from "react";
import { Alert, Autocomplete, Button, TextField } from "@mui/material";
import { fetchStory, updateStoryManagement } from "../api";
import type { StoryListItem } from "../types";
import type { ProductionMutationCoordinator } from "../../production/types";

export type StoryAuthorPatch = Pick<StoryListItem, "author" | "management">;
type Author = StoryListItem["author"];
interface Props {
  story: Pick<StoryListItem, "id" | "title" | "author" | "management">;
  onChanged: (patch: StoryAuthorPatch) => void;
  mutationPending: boolean;
  onMutate: ProductionMutationCoordinator;
}
const displayName = (author: Author) => author.display_name.trim() || author.username;

export default function StoryAuthorControl({ story, onChanged, mutationPending, onMutate }: Props) {
  const [selected, setSelected] = useState<Author | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const scope = useRef({ storyId: story.id, generation: 0 });
  const pendingRef = useRef(false);
  if (scope.current.storyId !== story.id) scope.current = { storyId: story.id, generation: 0 };
  useEffect(() => {
    const currentScope = scope.current;
    setSelected(null); setPending(false); pendingRef.current = false;
    setError(""); setAcknowledged(false);
    return () => { currentScope.generation += 1; };
  }, [story.id]);
  useEffect(() => {
    // The current author may also be an unresolved retry target after an uncertain PATCH.
    if (!pending && !acknowledged && !error && selected?.id === story.author.id) setSelected(null);
  }, [story.author.id, selected, pending, acknowledged, error]);

  const save = async (author: Author) => {
    if (!story.management || pendingRef.current || mutationPending) return;
    const activeScope = scope.current;
    const generation = ++activeScope.generation;
    const isCurrent = () => scope.current === activeScope && activeScope.generation === generation;
    pendingRef.current = true;
    setPending(true); setSelected(author); setError("");
    try {
      const result = await onMutate(async () => {
        if (!acknowledged) {
          await updateStoryManagement(story.management!.action, { author_user_id: author.id });
          if (!isCurrent()) return;
          setAcknowledged(true);
        }
        const updated = await fetchStory(story.id);
        if (!isCurrent()) return;
        onChanged({ author: updated.author, management: updated.management });
        setAcknowledged(false);
      });
      if (isCurrent() && result && !result.commandAcknowledged) setSelected(null);
    } catch (requestError) {
      if (isCurrent()) setError(requestError instanceof Error ? requestError.message : "Не удалось изменить автора");
    } finally {
      if (isCurrent()) { pendingRef.current = false; setPending(false); }
    }
  };
  const value = selected ?? story.author;
  const available = story.management?.author_options ?? [];
  const options = available.some((author) => author.id === value.id) ? available : [value, ...available];
  return (
    <>
      <div className="production-assignment">
        <span className="production-assignment-label">Автор</span>
        {story.management ? (
          <Autocomplete<Author, false, true> disableClearable autoSelect={false} selectOnFocus={false}
            value={value} options={options} getOptionLabel={displayName}
            isOptionEqualToValue={(option, candidate) => option.id === candidate.id}
            getOptionDisabled={(option) => !available.some((author) => author.id === option.id)}
            disabled={pending || mutationPending || acknowledged}
            onChange={(_event, author, reason) => {
              if (reason !== "selectOption" || (author.id === story.author.id && !error)) return;
              void save(author);
            }}
            renderInput={(params) => <TextField {...params} placeholder="Найти сотрудника"
              slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, "aria-label": "Ответственный: Автор" } }} />}
          />
        ) : <span className="muted">{displayName(story.author)}</span>}
      </div>
      {error ? <Alert severity="error" action={<Button color="inherit" disabled={pending || mutationPending}
        onClick={() => { if (selected) void save(selected); }}>
        {acknowledged ? "Повторить обновление автора" : "Повторить назначение автора"}
      </Button>}>{error}</Alert> : null}
    </>
  );
}
