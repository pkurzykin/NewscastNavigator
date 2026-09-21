import ScenarioIcon from "./ScenarioIcon";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  IconButton,
  Switch,
  FormControlLabel,
} from "@mui/material";
import { ScenarioAccessContext } from "../ScenarioAccessContext";
import { useScenarioAccess } from "../useScenarioAccess";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";

import { exportScenarioDocx, fetchScenario, saveScenario } from "../api";
import { clearScenarioDraft, readScenarioDraft, fieldCandidateKey, adoptRecoveredScenarioDraft } from "../draftStorage";
import { getMetadataSaveCoordinator } from "../metadataSaveCoordinator";
import {
  cloneScenarioRow,
  createEmptyScenarioRow,
  createSegmentUid,
  withOrderIndexes,
} from "../rowIdentity";
import {
  BLOCK_OPTIONS,
  DEFAULT_EDITOR_COLUMN_WIDTHS,
  EDITOR_COLUMNS,
  EDITOR_COLUMN_WIDTHS_STORAGE_KEY,
  FILL_COLOR_OPTIONS,
  FONT_OPTIONS,
  MIN_EDITOR_COLUMN_WIDTHS,
  blockTypeTone,
  loadEditorColumnWidths,
  preferredFocusTarget,
  scenarioFormatting,
  setScenarioFormatting,
} from "../scenarioTableModel";
import type {
  ScenarioDraft,
  ScenarioContentSnapshot,
  ScenarioFormattingTarget,
  ScenarioRow,
  ScenarioSnapshot,
} from "../types";
import type { RubricRef } from "../../../shared/contracts";
import { registerNavigationBlocker } from "../../../app/navigationGuard";
import { EditLeaseHandoffCoordinator, useEditLease } from "../useEditLease";
import { useScenarioAutosave } from "../useScenarioAutosave";
import {
  prepareScenarioDocxDownload,
  triggerBrowserDownload,
} from "../scenarioDocxExportCoordinator";
import {
  breakScenarioHistoryGroup,
  recordScenarioMutation,
  redoScenarioMutation,
  resetScenarioHistory,
  undoScenarioMutation,
  type ScenarioHistoryState,
  type ScenarioMutationMeta,
} from "../scenarioHistory";
import { reorderScenarioRows } from "../scenarioRowReorder";
import {
  findScenarioMatches,
  replaceScenarioMatches,
  type ScenarioSearchMatch,
} from "../scenarioSearch";
import {
  SCENARIO_PROSE_TARGETS,
  scenarioTextFieldKey,
  type ScenarioProseTarget,
  type ScenarioTextFieldController,
} from "../scenarioTextFields";
import AutosaveStatus from "./AutosaveStatus";
import CaptionPanelsStatus from "./CaptionPanelsStatus";
import EditLeaseNotice from "./EditLeaseNotice";
import ScenarioMetadataHeader from "./ScenarioMetadataHeader";
import ScenarioHistoryControls from "./ScenarioHistoryControls";
import ScenarioSearchPanel from "./ScenarioSearchPanel";
import ScenarioRowComponent, { type ScenarioFormatScope } from "./ScenarioRow";
import { fetchWorkflow } from "../../workflow/api";
import WorkflowActions from "../../workflow/components/WorkflowActions";
import type { WorkflowReadModel } from "../../workflow/types";

interface Props {
  storyId: number;
  userId: number;
  userFunctions?: readonly string[];
  leaseCoordinator?: EditLeaseHandoffCoordinator;
  onScenarioLoaded?: (revision: number) => void;
  onStoryMetadataChanged?: (patch: {
    title?: string;
    rubric?: RubricRef;
    duration_text?: string | null;
  }) => void;
}

export type EditorFocusBookmark =
  | { kind: "tiptap"; editorId: string; from: number; to: number }
  | {
      kind: "native";
      ariaLabel: string;
      selectionStart: number | null;
      selectionEnd: number | null;
    };

function ensureEditableRows(rows: ScenarioRow[]): ScenarioRow[] {
  return withOrderIndexes(rows.length ? rows : [createEmptyScenarioRow(1)]);
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  const tagName = element?.tagName.toLowerCase() || "";
  return ["input", "textarea", "select", "button"].includes(tagName)
    || Boolean(element?.isContentEditable)
    || Boolean(element?.closest(".rich-text-field"));
}

function isScenarioHistoryShortcutTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return true;
  if (element.closest(".scenario-history-controls")) return true;
  if (element.closest(".editor-table tbody")) return true;
  return !isEditableKeyboardTarget(element);
}

function canRestoreFocus(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected) return false;
  return !(element instanceof HTMLButtonElement
    || element instanceof HTMLInputElement
    || element instanceof HTMLSelectElement
    || element instanceof HTMLTextAreaElement)
    || !element.disabled;
}

interface SearchContinuationAnchor {
  segmentUid: string;
  target: ScenarioProseTarget;
  insertedFrom: number;
  afterOffset: number;
}

function searchContinuationIndex(
  rows: ScenarioRow[],
  matches: ScenarioSearchMatch[],
  anchor: SearchContinuationAnchor,
): number {
  const anchorRowIndex = rows.findIndex((row) => row.segment_uid === anchor.segmentUid);
  const anchorTargetIndex = SCENARIO_PROSE_TARGETS.indexOf(anchor.target);
  if (anchorRowIndex < 0 || anchorTargetIndex < 0) return matches.length ? 0 : -1;

  const rowIndexes = new Map(rows.map((row, index) => [row.segment_uid, index]));
  const eligibleIndexes = matches.flatMap((match, index) => {
    const overlapsInsertedRange = match.segmentUid === anchor.segmentUid
      && match.target === anchor.target
      && match.from < anchor.afterOffset
      && match.to > anchor.insertedFrom;
    return overlapsInsertedRange ? [] : [index];
  });
  const afterAnchor = eligibleIndexes.find((index) => {
    const match = matches[index];
    const rowIndex = rowIndexes.get(match.segmentUid);
    const targetIndex = SCENARIO_PROSE_TARGETS.indexOf(match.target);
    if (rowIndex === undefined || targetIndex < 0) return false;
    if (rowIndex !== anchorRowIndex) return rowIndex > anchorRowIndex;
    if (targetIndex !== anchorTargetIndex) return targetIndex > anchorTargetIndex;
    return match.from >= anchor.afterOffset;
  });
  return afterAnchor ?? eligibleIndexes[0] ?? (matches.length ? 0 : -1);
}

interface ScenarioConflict {
  localDraft: ScenarioDraft;
  serverSnapshot: ScenarioSnapshot;
}

interface ScenarioDragState {
  sourceUid: string;
  pointerId: number;
  targetUid: string | null;
  edge: "before" | "after" | null;
}

function rowPreview(row: ScenarioRow): string {
  return [
    row.text,
    row.speaker_text,
    row.file_name,
    row.tc_in,
    row.tc_out,
    row.additional_comment,
  ].filter(Boolean).join(" · ") || "Пустая строка";
}

function dialogFocusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), '
      + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden"));
}

function trapDialogFocus(
  event: ReactKeyboardEvent<HTMLElement>,
  root: HTMLElement,
) {
  if (event.key !== "Tab") return;
  const focusable = dialogFocusableElements(root);
  if (!focusable.length) {
    event.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

export default function ScenarioEditor({
  storyId,
  userId,
  userFunctions = [],
  leaseCoordinator,
  onScenarioLoaded,
  onStoryMetadataChanged,
}: Props) {
  const pendingInputFields = useRef(new Set<string>());
  const [savedInputCandidates, setSavedInputCandidates] = useState(() => {
    const prefix = `newscast:scenario-input:${storyId}:${userId}:`;
    try { return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
      .filter((key): key is string => Boolean(key?.startsWith(prefix)))
      .flatMap((key) => { try { const item = JSON.parse(localStorage.getItem(key) || "null"); return typeof item?.text === "string" ? [item as { text: string; field: string }] : []; } catch { return []; } });
    } catch { return []; }
  });
  const storeInputCandidate = useCallback((field: string, candidate: { text: string; doc?: unknown } | null) => {
    if (candidate) pendingInputFields.current.add(field); else pendingInputFields.current.delete(field);
    try {
      const key = fieldCandidateKey(storyId, userId, field);
      if (candidate) localStorage.setItem(key, JSON.stringify({ ...candidate, field, revision: autosave.revisionRef.current }));
      else localStorage.removeItem(key);
    } catch { /* The visible input candidate remains available if browser storage is full. */ }
  }, [storyId, userId]);
  const [snapshot, setSnapshot] = useState<ScenarioSnapshot | null>(null);
  const [content, setContent] = useState<ScenarioContentSnapshot>({ rows: [], default_font_family: "PT Sans" });
  const { rows, default_font_family: defaultFontFamily } = content;
  const contentRef = useRef(content);
  const applyContent = useCallback((next: ScenarioContentSnapshot) => {
    contentRef.current = next;
    setContent(next);
  }, []);
  const [loadError, setLoadError] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowReadModel | null>(null);
  const [workflowError, setWorkflowError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [conflict, setConflict] = useState<ScenarioConflict | null>(null);
  const [confirmServerDiscard, setConfirmServerDiscard] = useState(false);
  const [conflictRefreshError, setConflictRefreshError] = useState("");
  const [conflictRefreshing, setConflictRefreshing] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [formatScope, setFormatScope] = useState<ScenarioFormatScope | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    segmentUid: string;
    target: ReturnType<typeof preferredFocusTarget>;
    nonce: number;
  } | null>(null);
  const [toolbarTop, setToolbarTop] = useState(75);
  useEffect(() => {
    const header = document.querySelector(".app-shell-header");
    if (!header || typeof ResizeObserver === "undefined") return;
    const update = () => setToolbarTop(header.getBoundingClientRect().bottom + 12);
    update(); const observer = new ResizeObserver(update); observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const [columnWidths, setColumnWidths] = useState(loadEditorColumnWidths);
  const [historyState, setHistoryState] = useState<ScenarioHistoryState>(resetScenarioHistory);
  const [searchMode, setSearchMode] = useState<"find" | "replace" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchReplacement, setSearchReplacement] = useState("");
  const [searchMatchCase, setSearchMatchCase] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [readingToolsExpanded, setReadingToolsExpanded] = useState(false);
  const historyRef = useRef<ScenarioHistoryState>(resetScenarioHistory());
  const editorsRef = useRef(new Map<string, TiptapEditor>());
  const searchControllersRef = useRef(new Map<string, ScenarioTextFieldController>());
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const searchFocusFrameRef = useRef<number | null>(null);
  const lastSearchEditorFocusRef = useRef<HTMLElement | null>(null);
  const pendingSearchContinuationRef = useRef<SearchContinuationAnchor | null>(null);
  const pendingHistoryFocusRef = useRef<{
    bookmark: EditorFocusBookmark | null;
    scrollY: number;
  } | null>(null);
  const snapshotRef = useRef<ScenarioSnapshot | null>(null);
  const focusRequestNonceRef = useRef(0);
  const columnResizeCleanupRef = useRef<(() => void) | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const dragRef = useRef<ScenarioDragState | null>(null);
  const [dragState, setDragState] = useState<ScenarioDragState | null>(null);
  const workflowRequestRef = useRef(0);
  const exportingRef = useRef(false);
  const conflictDialogRef = useRef<HTMLElement | null>(null);
  const localConflictButtonRef = useRef<HTMLButtonElement | null>(null);
  const serverConflictButtonRef = useRef<HTMLButtonElement | null>(null);
  const conflictCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const conflictLayoutRef = useRef<{
    scrollY: number;
    documentHeight: number;
    activeAriaLabel: string | null;
  } | null>(null);
  const pendingConflictReturnRef = useRef<{
    scrollY: number;
    activeAriaLabel: string | null;
  } | null>(null);
  const loadedWorkflowStoryRef = useRef<number | null>(null);
  const currentWorkflowStoryRef = useRef(storyId);
  const interactionGuardRef = useRef({ canEdit: false, conflict: false });
  const searchModeRef = useRef<typeof searchMode>(null);
  const searchPresentationRef = useRef<{
    open: boolean;
    matches: ScenarioSearchMatch[];
    activeIndex: number;
  }>({ open: false, matches: [], activeIndex: 0 });
  searchModeRef.current = searchMode;
  currentWorkflowStoryRef.current = storyId;
  const lease = useEditLease(storyId, leaseCoordinator);
  const persistScenario = useCallback(
    (payload: Parameters<typeof saveScenario>[1]) => saveScenario(storyId, payload),
    [storyId],
  );
  const loadWorkflow = useCallback(async () => {
    const requestId = workflowRequestRef.current + 1;
    workflowRequestRef.current = requestId;
    try {
      const nextWorkflow = await fetchWorkflow(storyId);
      if (requestId !== workflowRequestRef.current || currentWorkflowStoryRef.current !== storyId) {
        return;
      }
      setWorkflow(nextWorkflow);
      setWorkflowError("");
    } catch (requestError) {
      if (requestId !== workflowRequestRef.current || currentWorkflowStoryRef.current !== storyId) {
        return;
      }
      setWorkflowError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить редакционный процесс",
      );
    }
  }, [storyId]);

  const captureConflictLayout = useCallback(() => {
    if (conflictLayoutRef.current) return;
    conflictLayoutRef.current = {
      scrollY: window.scrollY,
      documentHeight: document.documentElement.scrollHeight,
      activeAriaLabel: document.activeElement instanceof HTMLElement
        ? document.activeElement.getAttribute("aria-label")
        : null,
    };
  }, []);

  const handleRevisionConflict = useCallback(async (localDraft: ScenarioDraft) => {
    captureConflictLayout();
    const fallback = snapshotRef.current;
    if (fallback) {
      setConflict({ localDraft, serverSnapshot: fallback });
    }
    setConfirmServerDiscard(false);
    setConflictRefreshError("");
    setConflictRefreshing(true);
    try {
      const next = await fetchScenario(storyId);
      if (currentWorkflowStoryRef.current !== storyId) return;
      snapshotRef.current = next;
      setSnapshot(next);
      const serverRows = ensureEditableRows(next.scenario.rows);
      applyContent({ rows: serverRows, default_font_family: next.scenario.default_font_family ?? "PT Sans" });
      setConflict({ localDraft, serverSnapshot: next });
      setConflictRefreshing(false);
      onScenarioLoaded?.(next.scenario.revision);
    } catch (requestError) {
      if (currentWorkflowStoryRef.current !== storyId) return;
      setConflictRefreshing(false);
      setConflictRefreshError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить актуальный текст с сервера.",
      );
    }
  }, [captureConflictLayout, onScenarioLoaded, storyId]);

  const access = useScenarioAccess({
    storyId, userId, functions: userFunctions, loaded: snapshot?.story.id === storyId,
    edit: snapshot?.edit ?? { state: "available" },
    revision: () => autosave.revisionRef.current,
    lease,
    hasPendingInput: () => pendingInputFields.current.size > 0,
    flush: async () => {
      await Promise.all([autosave.flushPending(), exportMetadataCoordinator?.flushLatestDesired()]);
    },
    onRevisionMismatch: async () => {
      try {
        const prefix = `newscast:scenario-input:${storyId}:${userId}:`;
        setSavedInputCandidates(Object.keys(localStorage).filter((key) => key.startsWith(prefix)).flatMap((key) => {
          try { const item = JSON.parse(localStorage.getItem(key) || "null"); return typeof item?.text === "string" ? [item] : []; } catch { return []; }
        }));
      } catch { /* Current in-memory candidates remain until the explicit conflict view. */ }
      // During recovery, the editor content is the server side of the comparison.
      // A newer lease revision must preserve the original local draft and its font.
      await handleRevisionConflict(conflict?.localDraft ?? {
        revision: autosave.revisionRef.current,
        ...structuredClone(contentRef.current),
        saved_at: new Date().toISOString(),
      });
    },
  });
  const autosave = useScenarioAutosave({
    storyId,
    userId,
    initialRevision: snapshot?.scenario.revision ?? 0,
    ensureLease: access.getOwnedLease,
    canDeliver: access.canDeliver,
    onAccessLost: access.revoke,
    save: persistScenario,
    resumeVersion: lease.resumeVersion,
    onAcknowledgedRevision: () => { void loadWorkflow(); },
    onRevisionConflict: handleRevisionConflict,
  });
  const snapshotMatchesStory = snapshot?.story.id === storyId;
  const readOnly = !snapshotMatchesStory || !access.canMutate();
  const canRequest = snapshotMatchesStory && access.policy === "editorial"
    && snapshot?.edit.state !== "archived" && ["available"].includes(access.edit.state) && !["leaving", "release-error"].includes(access.phase);
  const controlsReadOnly = readOnly && !canRequest;
  const hasEditingSession = ["editing", "leaving", "release-error"].includes(access.phase);
  const editorToolsVisible = hasEditingSession || readingToolsExpanded;
  useEffect(() => {
    if (!hasEditingSession) setReadingToolsExpanded(false);
  }, [hasEditingSession, storyId]);
  interactionGuardRef.current = {
    canEdit: !readOnly,
    conflict: snapshotMatchesStory && Boolean(conflict),
  };
  const searchMatches = useMemo(
    () => searchMode ? findScenarioMatches(rows, searchQuery, searchMatchCase) : [],
    [rows, searchMatchCase, searchMode, searchQuery],
  );
  const clampedSearchIndex = searchMatches.length
    ? Math.max(0, Math.min(searchActiveIndex, searchMatches.length - 1))
    : 0;
  searchPresentationRef.current = {
    open: Boolean(searchMode),
    matches: searchMatches,
    activeIndex: clampedSearchIndex,
  };

  useEffect(() => {
    if (searchActiveIndex !== clampedSearchIndex) {
      setSearchActiveIndex(clampedSearchIndex);
    }
  }, [clampedSearchIndex, searchActiveIndex]);

  const replaceHistory = useCallback((next: ScenarioHistoryState) => {
    historyRef.current = next;
    setHistoryState(next);
  }, []);

  const resetHistory = useCallback(() => {
    replaceHistory(resetScenarioHistory());
  }, [replaceHistory]);

  const breakHistoryGroup = useCallback(() => {
    const next = breakScenarioHistoryGroup(historyRef.current);
    if (next !== historyRef.current) replaceHistory(next);
  }, [replaceHistory]);

  const captureFocusBookmark = useCallback((): EditorFocusBookmark | null => {
    for (const [editorId, editor] of editorsRef.current) {
      if (!editor.isFocused) continue;
      const { from, to } = editor.state.selection;
      return { kind: "tiptap", editorId, from, to };
    }
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const ariaLabel = active.getAttribute("aria-label");
    if (!ariaLabel) return null;
    const selectionTarget = active instanceof HTMLInputElement
      || active instanceof HTMLTextAreaElement
      ? active
      : null;
    return {
      kind: "native",
      ariaLabel,
      selectionStart: selectionTarget?.selectionStart ?? null,
      selectionEnd: selectionTarget?.selectionEnd ?? null,
    };
  }, []);

  const applyHistorySnapshot = useCallback((nextSnapshot: ScenarioContentSnapshot) => {
    if (!access.canMutate()) return;
    const next = ensureEditableRows(nextSnapshot.rows);
    pendingHistoryFocusRef.current = {
      bookmark: captureFocusBookmark(),
      scrollY: window.scrollY,
    };
    applyContent({ rows: next, default_font_family: nextSnapshot.default_font_family });
    setSelectedRowIds((current) => current.filter((segmentUid) => (
      next.some((row) => row.segment_uid === segmentUid)
    )));
    setFormatScope((current) => {
      if (!current) return null;
      const rowIndex = next.findIndex((row) => row.segment_uid === current.segmentUid);
      if (rowIndex < 0) return null;
      return {
        ...current,
        rowIndex,
        config: scenarioFormatting(next[rowIndex], current.target, nextSnapshot.default_font_family),
        fontOverride: next[rowIndex].formatting.targets?.[current.target]?.font_family,
      };
    });
    lease.touch();
    autosave.scheduleSave(contentRef.current);
  }, [autosave, captureFocusBookmark, lease]);

  const undo = useCallback(() => {
    const guard = interactionGuardRef.current;
    if (!guard.canEdit || !access.canMutate() || guard.conflict || dragRef.current) return;
    const transition = undoScenarioMutation(historyRef.current, contentRef.current);
    if (!transition) return;
    replaceHistory(transition.state);
    applyHistorySnapshot(transition);
  }, [applyHistorySnapshot, replaceHistory]);

  const redo = useCallback(() => {
    const guard = interactionGuardRef.current;
    if (!guard.canEdit || !access.canMutate() || guard.conflict || dragRef.current) return;
    const transition = redoScenarioMutation(historyRef.current, contentRef.current);
    if (!transition) return;
    replaceHistory(transition.state);
    applyHistorySnapshot(transition);
  }, [applyHistorySnapshot, replaceHistory]);

  const setControllerHighlights = useCallback((
    editorId: string,
    controller: ScenarioTextFieldController,
    presentation = searchPresentationRef.current,
  ) => {
    if (!presentation.open) {
      controller.setSearchHighlights([]);
      return;
    }
    controller.setSearchHighlights(presentation.matches.flatMap((match, index) => (
      scenarioTextFieldKey(match) === editorId
        ? [{ from: match.from, to: match.to, active: index === presentation.activeIndex }]
        : []
    )));
  }, []);

  const clearSearchHighlights = useCallback(() => {
    searchControllersRef.current.forEach((controller) => controller.setSearchHighlights([]));
  }, []);

  const handleEditorRegister = useCallback((
    editorId: string,
    editor: TiptapEditor | null,
    controller: ScenarioTextFieldController | null,
  ) => {
    if (editor) editorsRef.current.set(editorId, editor);
    else editorsRef.current.delete(editorId);
    if (controller) {
      searchControllersRef.current.set(editorId, controller);
      setControllerHighlights(editorId, controller);
    } else {
      searchControllersRef.current.delete(editorId);
    }
  }, [setControllerHighlights]);

  const openSearch = useCallback((
    mode: "find" | "replace",
    returnFocusTo?: HTMLElement | null,
  ) => {
    const guard = interactionGuardRef.current;
    if (guard.conflict || (mode === "replace" && !guard.canEdit)) return;
    setReadingToolsExpanded(true);
    if (!searchModeRef.current) {
      const active = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const target = returnFocusTo ?? (
        active === document.body && lastSearchEditorFocusRef.current?.isConnected
          ? lastSearchEditorFocusRef.current
          : active
      );
      // The temporary input can disappear after grant while search stays open.
      searchReturnFocusRef.current = target?.closest(".pending-field-input")
        ? target.closest(".rich-text-field")?.querySelector<HTMLElement>("[hidden] [role=textbox]") ?? target
        : target;
    }
    setSearchMode(mode);
    setSearchFocusRequest((current) => current + 1);
  }, []);

  const closeSearch = useCallback(() => {
    if (!searchModeRef.current) return;
    clearSearchHighlights();
    setSearchMode(null);
    setSearchActiveIndex(0);
    setSearchFocusRequest(0);
    pendingSearchContinuationRef.current = null;
    const returnTarget = searchReturnFocusRef.current;
    searchReturnFocusRef.current = null;
    if (searchFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(searchFocusFrameRef.current);
    }
    searchFocusFrameRef.current = window.requestAnimationFrame(() => {
      searchFocusFrameRef.current = null;
      const visibleTarget = returnTarget?.closest(".rich-text-field")
        ?.querySelector<HTMLElement>(".pending-field-input [role=textbox]") ?? returnTarget;
      if (canRestoreFocus(visibleTarget)) visibleTarget.focus({ preventScroll: true });
    });
  }, [clearSearchHighlights]);

  const focusSearchMatch = useCallback((match: ScenarioSearchMatch) => {
    const controller = searchControllersRef.current.get(scenarioTextFieldKey(match));
    if (!controller) return;
    controller.focusRange(match.from, match.to);
    const field = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>(".rich-text-field")
      : null;
    field?.scrollIntoView({ block: "center" });
  }, []);

  const navigateSearch = useCallback((direction: -1 | 1) => {
    if (!searchMatches.length) return;
    const nextIndex = (
      clampedSearchIndex + direction + searchMatches.length
    ) % searchMatches.length;
    setSearchActiveIndex(nextIndex);
    focusSearchMatch(searchMatches[nextIndex]);
  }, [clampedSearchIndex, focusSearchMatch, searchMatches]);

  useEffect(() => {
    const anchor = pendingSearchContinuationRef.current;
    if (!anchor) return;
    pendingSearchContinuationRef.current = null;
    const nextIndex = searchContinuationIndex(rows, searchMatches, anchor);
    if (nextIndex < 0) {
      setSearchActiveIndex(0);
      return;
    }
    setSearchActiveIndex(nextIndex);
    focusSearchMatch(searchMatches[nextIndex]);
  }, [focusSearchMatch, rows, searchMatches]);

  useEffect(() => {
    const presentation = searchPresentationRef.current;
    searchControllersRef.current.forEach((controller, editorId) => {
      setControllerHighlights(editorId, controller, presentation);
    });
  }, [clampedSearchIndex, searchMatches, searchMode, setControllerHighlights]);

  useEffect(() => {
    if (!conflict || !searchModeRef.current) return;
    clearSearchHighlights();
    setSearchMode(null);
    setSearchActiveIndex(0);
    pendingSearchContinuationRef.current = null;
    searchReturnFocusRef.current = null;
    lastSearchEditorFocusRef.current = null;
    if (searchFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(searchFocusFrameRef.current);
      searchFocusFrameRef.current = null;
    }
  }, [clearSearchHighlights, conflict]);

  useEffect(() => () => {
    clearSearchHighlights();
    if (searchFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(searchFocusFrameRef.current);
    }
  }, [clearSearchHighlights]);
  const exportMetadataCoordinator = useMemo(() => {
    if (
      snapshot?.story.id !== storyId
      || snapshot.story.rubric === undefined
    ) return null;
    return getMetadataSaveCoordinator(storyId, {
      title: snapshot.story.title,
      rubricId: snapshot.story.rubric.id,
      durationText: snapshot.story.duration_text,
    });
  }, [snapshot?.story.id, storyId]);

  useEffect(() => {
    exportMetadataCoordinator?.setDeliveryGate(access.canDeliver);
    return () => { exportMetadataCoordinator?.setDeliveryGate(() => false); };
  }, [access.canDeliver, exportMetadataCoordinator]);

  useEffect(
    () => exportMetadataCoordinator?.retainOwner(),
    [exportMetadataCoordinator],
  );

  useEffect(() => {
    if (loadedWorkflowStoryRef.current === storyId) return;
    loadedWorkflowStoryRef.current = storyId;
    setWorkflow(null);
    setWorkflowError("");
    void loadWorkflow();
  }, [loadWorkflow, storyId]);

  useEffect(() => {
    resetHistory();
    clearSearchHighlights();
    setSearchMode(null);
    setSearchQuery("");
    setSearchReplacement("");
    setSearchMatchCase(false);
    setSearchActiveIndex(0);
    searchReturnFocusRef.current = null;
    lastSearchEditorFocusRef.current = null;
    pendingSearchContinuationRef.current = null;
    editorsRef.current.clear();
    searchControllersRef.current.clear();
    pendingHistoryFocusRef.current = null;
    snapshotRef.current = null;
    setSnapshot(null);
    setLoadError("");
    setConflict(null);
  }, [clearSearchHighlights, resetHistory, storyId]);

  useEffect(() => {
    const pending = pendingHistoryFocusRef.current;
    if (!pending) return;
    pendingHistoryFocusRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      try {
        if (pending.bookmark?.kind === "tiptap") {
          const editor = editorsRef.current.get(pending.bookmark.editorId);
          editor?.chain()
            .setTextSelection({
              from: pending.bookmark.from,
              to: pending.bookmark.to,
            })
            .focus(undefined, { scrollIntoView: false })
            .run();
        } else if (pending.bookmark?.kind === "native") {
          const bookmark = pending.bookmark;
          const target = [...document.querySelectorAll<HTMLElement>("[aria-label]")]
            .find((element) => (
              element.getAttribute("aria-label") === bookmark.ariaLabel
            ));
          target?.focus({ preventScroll: true });
          if (
            target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
          ) {
            if (
              bookmark.selectionStart !== null
              && bookmark.selectionEnd !== null
            ) {
              target.setSelectionRange(
                bookmark.selectionStart,
                bookmark.selectionEnd,
              );
            }
          }
        }
      } catch {
        // A structural undo may remove the bookmarked field.
      } finally {
        window.scrollTo(0, pending.scrollY);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [content]);

  useEffect(() => {
    let active = true;
    void fetchScenario(storyId)
      .then((next) => {
        if (!active) return;
        const draft = readScenarioDraft(storyId, userId);
        if (draft) {
          conflictLayoutRef.current = null;
          autosave.enterConflict(draft);
          setConflict({ localDraft: draft, serverSnapshot: next });
        } else {
          setConflict(null);
        }
        setConfirmServerDiscard(false);
        setConflictRefreshError("");
        setConflictRefreshing(false);
        const initialRows = next.scenario.rows;
        const ordered = ensureEditableRows(initialRows);
        resetHistory();
        applyContent({ rows: ordered, default_font_family: next.scenario.default_font_family ?? "PT Sans" });
        setSelectedRowIds([]);
        setFormatScope(null);
        setFocusRequest(null);
        snapshotRef.current = next;
        setSnapshot(next);
        setLoadError("");
        onScenarioLoaded?.(next.scenario.revision);
      })
      .catch((requestError) => {
        if (active) {
          setLoadError(
            requestError instanceof Error ? requestError.message : "Не удалось загрузить сценарий",
          );
        }
      });
    return () => { active = false; };
  }, [onScenarioLoaded, resetHistory, storyId, userId]);

  const continueWithLocalText = useCallback(async () => {
    if (!conflict || conflictRefreshing || conflictRefreshError) return;
    if (!await access.requestEdit()) return;
    const nextRows = ensureEditableRows(conflict.localDraft.rows);
    applyContent({ rows: nextRows, default_font_family: conflict.localDraft.default_font_family });
    snapshotRef.current = conflict.serverSnapshot;
    setSnapshot(conflict.serverSnapshot);
    if (conflictLayoutRef.current) {
      pendingConflictReturnRef.current = {
        scrollY: conflictLayoutRef.current.scrollY,
        activeAriaLabel: conflictLayoutRef.current.activeAriaLabel,
      };
      conflictLayoutRef.current = null;
    }
    setConflict(null);
    setConfirmServerDiscard(false);
    setConflictRefreshError("");
    adoptRecoveredScenarioDraft(storyId, userId);
    autosave.rebaseConflict(contentRef.current, conflict.serverSnapshot.scenario.revision);
  }, [autosave, conflict, conflictRefreshError, conflictRefreshing]);

  const useServerText = useCallback(() => {
    if (!conflict || conflictRefreshing || conflictRefreshError) return;
    const nextRows = ensureEditableRows(conflict.serverSnapshot.scenario.rows);
    clearScenarioDraft(storyId, userId, true);
    autosave.discardConflict(conflict.serverSnapshot.scenario.revision);
    applyContent({ rows: nextRows, default_font_family: conflict.serverSnapshot.scenario.default_font_family ?? "PT Sans" });
    snapshotRef.current = conflict.serverSnapshot;
    setSnapshot(conflict.serverSnapshot);
    if (conflictLayoutRef.current) {
      pendingConflictReturnRef.current = {
        scrollY: conflictLayoutRef.current.scrollY,
        activeAriaLabel: conflictLayoutRef.current.activeAriaLabel,
      };
      conflictLayoutRef.current = null;
    }
    setConflict(null);
    setConfirmServerDiscard(false);
    setConflictRefreshError("");
    resetHistory();
  }, [
    autosave,
    conflict,
    conflictRefreshError,
    conflictRefreshing,
    storyId,
    userId,
    resetHistory,
  ]);

  const commitMutation = useCallback((
    updater: (current: ScenarioContentSnapshot) => ScenarioContentSnapshot,
    meta: ScenarioMutationMeta,
    options?: { allowDuringActiveDrag?: boolean },
  ): boolean => {
    const guard = interactionGuardRef.current;
    if (
      snapshotRef.current?.story.id !== storyId
      || !access.canMutate()
      || guard.conflict
      || (
        meta.kind === "structure"
        && dragRef.current
        && !options?.allowDuringActiveDrag
      )
    ) return false;
    const before = contentRef.current;
    const next = updater(before);
    if (JSON.stringify(before) === JSON.stringify(next)) return false;
    replaceHistory(recordScenarioMutation(historyRef.current, before, next, meta));
    applyContent(next);
    lease.touch();
    autosave.scheduleSave(contentRef.current);
    return true;
  }, [autosave, lease, replaceHistory]);

  const mutate = useCallback((updater: (rows: ScenarioRow[]) => ScenarioRow[], meta: ScenarioMutationMeta, options?: { allowDuringActiveDrag?: boolean }) =>
    commitMutation((current) => ({ ...current, rows: ensureEditableRows(updater(current.rows)) }), meta, options), [commitMutation]);

  const replaceActiveSearchMatch = useCallback(() => {
    if (!interactionGuardRef.current.canEdit || !searchMatches.length) return;
    const activeMatch = searchMatches[clampedSearchIndex];
    if (!activeMatch) return;
    pendingSearchContinuationRef.current = null;
    mutate((current) => {
      const next = replaceScenarioMatches(current, [activeMatch], searchReplacement);
      if (next !== current) {
        pendingSearchContinuationRef.current = {
          segmentUid: activeMatch.segmentUid,
          target: activeMatch.target,
          insertedFrom: activeMatch.from,
          afterOffset: activeMatch.from + searchReplacement.length,
        };
      }
      return next;
    }, { kind: "replace" });
  }, [clampedSearchIndex, mutate, searchMatches, searchReplacement]);

  const replaceAllSearchMatches = useCallback(() => {
    if (
      !interactionGuardRef.current.canEdit
      || !searchQuery
      || !searchMatches.length
    ) return;
    mutate(
      (current) => replaceScenarioMatches(current, searchMatches, searchReplacement),
      { kind: "replace-all" },
    );
  }, [mutate, searchMatches, searchQuery, searchReplacement]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (autosave.isDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [autosave]);

  useEffect(
    () => registerNavigationBlocker(autosave.isDirty),
    [autosave.isDirty],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        EDITOR_COLUMN_WIDTHS_STORAGE_KEY,
        JSON.stringify(columnWidths),
      );
    } catch {
      // Column widths are a convenience and must not break the editor.
    }
  }, [columnWidths]);

  useEffect(() => {
    if (["blocked", "reentry-required", "release-error", "leaving", "read"].includes(access.phase)) dragCleanupRef.current?.();
  }, [access.phase]);

  useEffect(() => () => {
    columnResizeCleanupRef.current?.();
    dragCleanupRef.current?.();
  }, []);

  useEffect(() => {
    if (!conflict) return;
    const frame = window.requestAnimationFrame(() => {
      const target = !conflictRefreshing && !conflictRefreshError
        ? localConflictButtonRef.current
        : conflictDialogRef.current;
      target?.focus({ preventScroll: true });
      if (conflictLayoutRef.current) {
        window.scrollTo(0, conflictLayoutRef.current.scrollY);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [Boolean(conflict), conflictRefreshError, conflictRefreshing]);

  useEffect(() => {
    if (!confirmServerDiscard) return;
    const frame = window.requestAnimationFrame(() => {
      conflictCancelButtonRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [confirmServerDiscard]);

  useEffect(() => {
    if (conflict || !pendingConflictReturnRef.current) return;
    const pending = pendingConflictReturnRef.current;
    pendingConflictReturnRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      const labeledElements = [
        ...document.querySelectorAll<HTMLElement>("[aria-label]"),
      ];
      const focusTarget = (
        pending.activeAriaLabel
          ? labeledElements.find(
              (element) => element.getAttribute("aria-label") === pending.activeAriaLabel,
            )
          : null
      ) ?? document.querySelector<HTMLElement>('[aria-label="Текст блока 1"]');
      focusTarget?.focus({ preventScroll: true });
      window.scrollTo(0, pending.scrollY);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conflict, rows]);

  const closeServerDiscardConfirmation = () => {
    setConfirmServerDiscard(false);
    window.requestAnimationFrame(() => {
      serverConflictButtonRef.current?.focus({ preventScroll: true });
    });
  };

  const selectRow = useCallback((segmentUid: string, multi: boolean, force = false) => {
    setSelectedRowIds((previous) => {
      if (force) {
        return previous.length === 1 && previous[0] === segmentUid
          ? previous
          : [segmentUid];
      }
      if (!multi) {
        return previous.length === 1 && previous[0] === segmentUid ? [] : [segmentUid];
      }
      const next = previous.includes(segmentUid)
        ? previous.filter((item) => item !== segmentUid)
        : [...previous, segmentUid];
      const order = new Map(
        contentRef.current.rows.map((row, index) => [row.segment_uid, index]),
      );
      return next.sort((left, right) =>
        (order.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(right) ?? Number.MAX_SAFE_INTEGER));
    });
  }, []);

  const requestEditorFocus = useCallback((
    segmentUid: string,
    target: ReturnType<typeof preferredFocusTarget>,
  ) => {
    focusRequestNonceRef.current += 1;
    setFocusRequest({
      segmentUid,
      target,
      nonce: focusRequestNonceRef.current,
    });
  }, []);

  const deleteSelectedRows = useCallback(() => {
    if (readOnly || selectedRowIds.length === 0) return;
    const selected = new Set(selectedRowIds);
    const firstSelectedIndex = contentRef.current.rows.findIndex((row) =>
      selected.has(row.segment_uid));
    const remaining = ensureEditableRows(
      contentRef.current.rows.filter((row) => !selected.has(row.segment_uid)),
    );
    const nextRow = remaining[Math.min(
      Math.max(firstSelectedIndex, 0),
      remaining.length - 1,
    )];
    if (!mutate(() => remaining, { kind: "structure" })) return;
    setSelectedRowIds([nextRow.segment_uid]);
    requestEditorFocus(nextRow.segment_uid, preferredFocusTarget(nextRow.block_type));
  }, [mutate, readOnly, requestEditorFocus, selectedRowIds]);

  const handleStoryMetadataChanged = useCallback((
    patch: {
      title?: string;
      rubric?: RubricRef;
      duration_text?: string | null;
    },
  ) => {
    setSnapshot((current) => {
      if (!current) return current;
      const next = { ...current, story: { ...current.story, ...patch } };
      snapshotRef.current = next;
      return next;
    });
    onStoryMetadataChanged?.(patch);
  }, [onStoryMetadataChanged]);

  const handleDocxExport = useCallback(async () => {
    if (exportingRef.current) return;
    const initial = snapshotRef.current;
    if (!initial || initial.story.id !== storyId) return;
    exportingRef.current = true;
    setExporting(true);
    setExportError("");
    try {
      const download = await prepareScenarioDocxDownload({
        readOnly: Boolean(readOnly),
        current: () => {
          const current = snapshotRef.current ?? initial;
          return {
            revision: autosave.revisionRef.current,
            title: current.story.title,
            rubricId: current.story.rubric?.id ?? null,
            durationText: current.story.duration_text,
          };
        },
        flushScenario: autosave.flushPending,
        flushMetadata: () => {
          if (exportMetadataCoordinator) {
            return exportMetadataCoordinator.flushLatestDesired();
          }
          return Promise.reject(new Error("У сценария не выбрана рубрика."));
        },
        request: (payload) => exportScenarioDocx(storyId, payload),
      });
      triggerBrowserDownload(download);
    } catch (requestError) {
      const detail = requestError instanceof Error
        ? requestError.message
        : "Не удалось подготовить файл.";
      setExportError(`Не удалось экспортировать DOCX. ${detail}`);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [
    autosave.flushPending,
    autosave.revisionRef,
    exportMetadataCoordinator,
    readOnly,
    storyId,
  ]);

  const addBlock = useCallback((blockType: ScenarioRow["block_type"]) => {
    if (readOnly) return;
    const selected = new Set(selectedRowIds);
    mutate((current) => {
      const lastSelectedIndex = current.reduce(
        (last, row, index) => selected.has(row.segment_uid) ? index : last,
        -1,
      );
      const insertionIndex = lastSelectedIndex >= 0 ? lastSelectedIndex + 1 : current.length;
      const next = [...current];
      const created = { ...createEmptyScenarioRow(insertionIndex + 1), block_type: blockType };
      next.splice(insertionIndex, 0, created);
      setSelectedRowIds([created.segment_uid]);
      requestEditorFocus(created.segment_uid, preferredFocusTarget(blockType));
      return next;
    }, { kind: "structure" });
  }, [mutate, readOnly, requestEditorFocus, selectedRowIds]);

  const applyFormatting = useCallback((
    patch: Partial<ScenarioFormattingTarget>,
    options?: { reset?: boolean; collapseSelection?: boolean },
  ) => {
    if (!access.canMutate() || !formatScope || formatScope.applySelection(patch, options)) return;
    const targetIds = new Set(
      selectedRowIds.length ? selectedRowIds : [formatScope.segmentUid],
    );
    let nextScopeConfig = formatScope.config;
    mutate((current) => current.map((row) => {
      if (!targetIds.has(row.segment_uid)) return row;
      const next = setScenarioFormatting(row, formatScope.target, patch);
      if (next.segment_uid === formatScope.segmentUid) {
        nextScopeConfig = scenarioFormatting(next, formatScope.target, contentRef.current.default_font_family);
      }
      return next;
    }), { kind: "formatting" });
    setFormatScope((current) => current && current.segmentUid === formatScope.segmentUid
      ? { ...current, config: nextScopeConfig, fontOverride: contentRef.current.rows.find((row) => row.segment_uid === current.segmentUid)?.formatting.targets?.[current.target]?.font_family }
      : current);
  }, [formatScope, mutate, selectedRowIds]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;
      const guard = interactionGuardRef.current;
      if (event.key === "Escape" && searchModeRef.current) {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (modifier && key === "f" && !guard.conflict) {
        event.preventDefault();
        openSearch("find");
        return;
      }
      if (modifier && key === "h") {
        if (guard.canEdit && !guard.conflict) {
          event.preventDefault();
          openSearch("replace");
        }
        return;
      }
      const isUndoShortcut = modifier && key === "z";
      const isRedoShortcut = event.ctrlKey && key === "y";
      const isHistoryShortcutTarget = isScenarioHistoryShortcutTarget(event.target);
      if (
        (isUndoShortcut || isRedoShortcut)
        && dragRef.current
        && isHistoryShortcutTarget
      ) {
        event.preventDefault();
        return;
      }
      if ((isUndoShortcut || isRedoShortcut) && guard.conflict && isHistoryShortcutTarget) {
        event.preventDefault();
        return;
      }
      if (guard.canEdit && isUndoShortcut && isHistoryShortcutTarget) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (guard.canEdit && isRedoShortcut && isHistoryShortcutTarget) {
        event.preventDefault();
        redo();
        return;
      }
      if (!guard.canEdit || isEditableKeyboardTarget(event.target)) return;
      const isStructuralShortcut = (
        (modifier && key === "d")
        || event.key === "Delete"
        || event.key === "Backspace"
        || event.key === "Enter"
        || (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown"))
      );
      if (dragRef.current && isStructuralShortcut) {
        event.preventDefault();
        return;
      }
      if (selectedRowIds.length === 0) return;
      const selectedIndex = contentRef.current.rows.findIndex(
        (row) => row.segment_uid === selectedRowIds[selectedRowIds.length - 1],
      );
      if (selectedIndex < 0) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        const source = contentRef.current.rows[selectedIndex];
        const duplicate = cloneScenarioRow(source);
        duplicate.segment_uid = createSegmentUid();
        if (!mutate((current) => [
          ...current.slice(0, selectedIndex + 1),
          duplicate,
          ...current.slice(selectedIndex + 1),
        ], { kind: "structure" })) return;
        setSelectedRowIds([duplicate.segment_uid]);
        requestEditorFocus(
          duplicate.segment_uid,
          preferredFocusTarget(duplicate.block_type),
        );
      } else if ((event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteSelectedRows();
      } else if (event.key === "Enter") {
        event.preventDefault();
        addBlock(contentRef.current.rows[selectedIndex].block_type);
      } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const direction = event.key === "ArrowUp" ? -1 : 1;
        const targetIndex = selectedIndex + direction;
        if (targetIndex < 0 || targetIndex >= contentRef.current.rows.length) return;
        if (event.shiftKey) {
          const selectedRow = contentRef.current.rows[selectedIndex];
          mutate((current) => {
            const next = [...current];
            [next[selectedIndex], next[targetIndex]] = [next[targetIndex], next[selectedIndex]];
            return next;
          }, { kind: "structure" });
          requestEditorFocus(
            selectedRow.segment_uid,
            formatScope?.segmentUid === selectedRow.segment_uid
              ? formatScope.target
              : preferredFocusTarget(selectedRow.block_type),
          );
        } else {
          const targetRow = contentRef.current.rows[targetIndex];
          setSelectedRowIds([targetRow.segment_uid]);
          requestEditorFocus(
            targetRow.segment_uid,
            preferredFocusTarget(targetRow.block_type),
          );
        }
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [
    addBlock,
    closeSearch,
    deleteSelectedRows,
    formatScope,
    mutate,
    openSearch,
    redo,
    requestEditorFocus,
    selectedRowIds,
    undo,
  ]);

  const handleColumnResizeStart = (
    columnKey: keyof typeof columnWidths,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    columnResizeCleanupRef.current?.();
    const startX = event.clientX;
    const startWidth = columnWidths[columnKey];
    const handlePointerMove = (moveEvent: PointerEvent) => {
      setColumnWidths((previous) => ({
        ...previous,
        [columnKey]: Math.max(
          MIN_EDITOR_COLUMN_WIDTHS[columnKey],
          startWidth + moveEvent.clientX - startX,
        ),
      }));
    };
    const cleanup = () => {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      if (columnResizeCleanupRef.current === cleanup) {
        columnResizeCleanupRef.current = null;
      }
    };
    columnResizeCleanupRef.current = cleanup;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  };

  const handleDragPointerDown = useCallback((
    sourceUid: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (dragRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      (!access.canMutate() && !canRequest)
      || event.button !== 0
      || event.isPrimary === false
    ) return;
    event.preventDefault();
    event.stopPropagation();
    dragCleanupRef.current?.();
    const captureHandle = event.currentTarget;
    const entrySignature = JSON.stringify(contentRef.current.rows);
    const ownedAtStart = access.canMutate();
    const acquired = ownedAtStart ? null : access.requestEdit();
    const pointerId = event.pointerId;
    const initial: ScenarioDragState = {
      sourceUid,
      pointerId,
      targetUid: null,
      edge: null,
    };
    dragRef.current = initial;
    setDragState(initial);
    try {
      captureHandle.setPointerCapture(pointerId);
    } catch {
      // A detached handle can lose capture between pointerdown and this call.
    }
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    const resolveDrop = (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY);
      const rowElement = element instanceof Element
        ? element.closest<HTMLTableRowElement>("tr[data-segment-uid]")
        : null;
      const targetUid = rowElement?.getAttribute("data-segment-uid") || null;
      const validTarget = targetUid
        && targetUid !== sourceUid
        && contentRef.current.rows.some((row) => row.segment_uid === targetUid);
      if (!validTarget || !rowElement) return { targetUid: null, edge: null } as const;
      const rect = rowElement.getBoundingClientRect();
      return {
        targetUid,
        edge: clientY < rect.top + rect.height / 2 ? "before" as const : "after" as const,
      };
    };
    let cleaned = false;
    let cleanup = (_releaseCapture = true) => {};
    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const current = dragRef.current;
      if (!current) return;
      const drop = resolveDrop(moveEvent.clientX, moveEvent.clientY);
      const next = { ...current, ...drop };
      dragRef.current = next;
      setDragState(next);
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      const current = dragRef.current;
      const drop = resolveDrop(upEvent.clientX, upEvent.clientY);
      if (current && drop.targetUid && drop.edge) {
        const targetUid = drop.targetUid;
        const edge = drop.edge;
        const commitDrop = (ok: boolean) => {
          if (!ok || !access.canMutate() || currentWorkflowStoryRef.current !== storyId
            || JSON.stringify(contentRef.current.rows) !== entrySignature) return;
          mutate((rowsAtMutation) => reorderScenarioRows(rowsAtMutation, current.sourceUid, targetUid, edge),
            { kind: "structure" }, { allowDuringActiveDrag: true });
        };
        if (ownedAtStart) commitDrop(true);
        else void acquired?.then(commitDrop);
      }
      cleanup();
    };
    const handlePointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== pointerId) return;
      cleanup();
    };
    const handleLostPointerCapture = (lostEvent: PointerEvent) => {
      if (lostEvent.pointerId !== pointerId) return;
      cleanup(false);
    };
    const handleWindowBlur = () => cleanup();
    cleanup = (releaseCapture = true) => {
      if (cleaned) return;
      cleaned = true;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      window.removeEventListener("blur", handleWindowBlur);
      captureHandle.removeEventListener("lostpointercapture", handleLostPointerCapture);
      if (releaseCapture) {
        try {
          if (captureHandle.hasPointerCapture(pointerId)) {
            captureHandle.releasePointerCapture(pointerId);
          }
        } catch {
          // Capture may already have been released by the browser.
        }
      }
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      dragRef.current = null;
      setDragState(null);
      if (dragCleanupRef.current === cleanup) dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    window.addEventListener("blur", handleWindowBlur);
    captureHandle.addEventListener("lostpointercapture", handleLostPointerCapture);
  }, [mutate, access, canRequest, storyId]);

  if (snapshot && !snapshotMatchesStory) {
    return <p className="muted" role="status">Загрузка сценария...</p>;
  }
  if (loadError) return <p className="error" role="alert">{loadError}</p>;
  if (!snapshot) return <p className="muted" role="status">Загрузка сценария...</p>;
  if (conflict) {
    return (
      <section
        className="scenario-editor"
        aria-label="Редактор сценария"
        style={conflictLayoutRef.current
          ? { minHeight: `${conflictLayoutRef.current.documentHeight}px` }
          : undefined}
      >
        {savedInputCandidates.length > 0 && <details open><summary>Отдельно сохранённый первый ввод</summary>
          <p>Скопируйте нужный фрагмент после сравнения с актуальным текстом.</p>
          {savedInputCandidates.map((item, index) => <pre key={index} style={{ whiteSpace: "pre-wrap" }}>{item.text}</pre>)}
        </details>}
        <div className="scenario-editor-heading">
          <h2>{snapshot.story.title || "Сценарий"}</h2>
        </div>
        <section
          ref={conflictDialogRef}
          className="scenario-conflict"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="scenario-conflict-title"
          aria-describedby="scenario-conflict-description"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (confirmServerDiscard) return;
            if (event.key === "Escape") {
              event.preventDefault();
              localConflictButtonRef.current?.focus({ preventScroll: true });
              return;
            }
            if (conflictDialogRef.current) {
              trapDialogFocus(event, conflictDialogRef.current);
            }
          }}
        >
          <h3 id="scenario-conflict-title">Конфликт локального черновика</h3>
          <p id="scenario-conflict-description">
            Локальный черновик сохранён. Выберите, какой текст продолжить использовать.
          </p>
          <div className="editor-toolbar-sticky" style={{ top: toolbarTop }}>
            <div className="editor-toolbar-card">
              <div className="editor-toolbar-actions">
                <ScenarioHistoryControls
                  canUndo={historyState.past.length > 0}
                  canRedo={historyState.future.length > 0}
                  disabled
                  onUndo={undo}
                  onRedo={redo}
                />
              </div>
            </div>
          </div>
          <div className="scenario-conflict-versions">
            <section aria-label="Сохранённый локальный текст">
              <h4>Локальный текст</h4>
              <p>Основной шрифт: {conflict.localDraft.default_font_family}</p>
              <p className="small muted">
                Основан на редакции {conflict.localDraft.revision}
              </p>
              <ol
                aria-label="Строки сохранённого локального текста"
                tabIndex={0}
              >
                {conflict.localDraft.rows.map((row) => (
                  <li key={row.segment_uid}>{rowPreview(row)}</li>
                ))}
              </ol>
            </section>
            <section aria-label="Актуальный текст с сервера">
              <h4>Текст с сервера</h4>
              <p>Основной шрифт: {conflict.serverSnapshot.scenario.default_font_family ?? "PT Sans"}</p>
              <p className="small muted">
                Редакция {conflict.serverSnapshot.scenario.revision}
              </p>
              <ol
                aria-label="Строки актуального текста с сервера"
                tabIndex={0}
              >
                {conflict.serverSnapshot.scenario.rows.map((row) => (
                  <li key={row.segment_uid}>{rowPreview(row)}</li>
                ))}
              </ol>
            </section>
          </div>
          <div className="scenario-conflict-actions">
            <Button
              ref={localConflictButtonRef}
              type="button"
              variant="contained"
              disabled={conflictRefreshing || Boolean(conflictRefreshError)}
              onClick={continueWithLocalText}
            >
              Продолжить с локальным текстом
            </Button>
            <Button
              ref={serverConflictButtonRef}
              type="button"
              variant="contained"
              color="error"
              disabled={conflictRefreshing || Boolean(conflictRefreshError)}
              onClick={() => setConfirmServerDiscard(true)}
            >
              Использовать текст с сервера
            </Button>
          </div>
          {conflictRefreshing ? (
            <p className="muted" role="status">
              Обновляем актуальный текст с сервера...
            </p>
          ) : null}
          {conflictRefreshError ? (
            <p className="error" role="alert">
              Не удалось обновить серверный текст: {conflictRefreshError}{" "}
              <Button
                type="button"
                variant="text"
                onClick={() => void handleRevisionConflict(conflict.localDraft)}
              >
                Повторить загрузку
              </Button>
            </p>
          ) : null}
          <Dialog
            open={confirmServerDiscard}
            onClose={(_event, reason) => {
              if (reason === "escapeKeyDown") closeServerDiscardConfirmation();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              closeServerDiscardConfirmation();
            }}
            slotProps={{
              paper: {
                role: "alertdialog",
                "aria-label": "Подтвердить отказ от локального текста",
              },
            }}
          >
            <DialogContent>
              <DialogContentText>
                Локальный черновик будет удалён. Это действие нельзя отменить.
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button
                ref={conflictCancelButtonRef}
                type="button"
                variant="outlined"
                onClick={closeServerDiscardConfirmation}
              >
                Отменить
              </Button>
              <Button type="button" variant="contained" color="error" onClick={useServerText}>
                Да, использовать текст с сервера
              </Button>
            </DialogActions>
          </Dialog>
        </section>
      </section>
    );
  }

  const accessTone = autosave.status === "error" || access.error || lease.error
    ? "has-error" : access.edit.state === "held" || (access.edit.state === "mine" && !hasEditingSession)
      ? "is-busy" : hasEditingSession ? "is-editing" : "";
  const workflowActions = workflow ? (
          <WorkflowActions
            workflow={workflow}
            revision={autosave.revision}
            disabled={autosave.status !== "idle"}
            beforeAction={access.leaveEditing}
            onRefresh={loadWorkflow}
          />
  ) : null;

  return (
    <ScenarioAccessContext.Provider value={{ canMutate: access.canMutate, canRequest, requestEdit: access.requestEdit, storeCandidate: storeInputCandidate, deactivateCandidate: (field) => pendingInputFields.current.delete(field) }}>
    <section className="scenario-editor" aria-label="Редактор сценария"
      onFocusCapture={(event) => {
        const field = (event.target as HTMLElement).closest<HTMLElement>(".rich-text-field");
        if (!field) return;
        lastSearchEditorFocusRef.current = field.querySelector<HTMLElement>("[hidden] [role=textbox]")
          ?? field.querySelector<HTMLElement>("[role=textbox]");
      }}
      onClickCapture={(event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".editor-toolbar-sticky button, .editor-table button");
        if (!button || button.disabled || access.canMutate() || !canRequest
          || button.dataset.scenarioIntent === "find"
          || button.classList.contains("editor-column-resizer")
          || button.textContent?.includes("DOCX")
          || button.closest(".pending-field-input")
          || button.closest(".scenario-search-panel") && !button.textContent?.includes("Заменить")) return;
        event.preventDefault(); event.stopPropagation();
        void access.requestEdit().then((ok) => { if (ok && button.isConnected) window.setTimeout(() => button.click(), 0); });
      }}>
      {workflow ? <div className="scenario-workflow-strip">
        {workflowActions}
      </div> : null}
      <div className={`scenario-access-bar ${accessTone}`}>
        <ScenarioIcon name="edit" />
        <div className="scenario-access-description">
          <strong>{hasEditingSession ? "Вы редактируете сценарий" : "Просмотр сценария"}</strong>
          <span>{!hasEditingSession
            ? access.edit.state === "archived" ? "Текст сохранён в архиве."
              : access.edit.state === "held" || access.edit.state === "mine" ? "Дождитесь завершения текущего редактирования."
              : "Для изменения текста включите редактирование."
            : "Изменения сохраняются автоматически. Остальные сотрудники видят режим чтения."}</span>
          <EditLeaseNotice edit={access.edit} error={access.error || lease.error} owned={hasEditingSession} />
        </div>
        <AutosaveStatus status={autosave.status} error={autosave.error} />
        {!hasEditingSession ? (
          <Button
            type="button"
            variant="text"
            size="small"
            className="scenario-tools-toggle"
            aria-expanded={readingToolsExpanded}
            aria-controls="scenario-editor-tools"
            onClick={() => {
              if (readingToolsExpanded) closeSearch();
              setReadingToolsExpanded((expanded) => !expanded);
            }}
          >
            {readingToolsExpanded ? "Скрыть инструменты" : "Показать инструменты"}
          </Button>
        ) : null}
        {snapshot.edit.state !== "archived" && access.edit.state !== "archived" && <FormControlLabel
          control={<Switch size="small" checked={hasEditingSession}
            disabled={["acquiring", "leaving"].includes(access.phase)}
            onChange={(_event, checked) => { if (checked) void access.requestEdit(); else void access.leaveEditing().catch(() => undefined); }} />}
          label="Редактирование сценария" />}
      </div>
      {access.phase === "release-error" && <Button type="button" variant="outlined" onClick={() => void access.retryRelease().catch(() => undefined)}>Повторить завершение редактирования</Button>}
      {savedInputCandidates.length > 0 && <details className="scenario-lease-notice">
        <summary>Локальный ввод из предыдущего открытия ({savedInputCandidates.length})</summary>
        <p>Эти фрагменты не записаны в сценарий. Сравните и скопируйте нужный текст.</p>
        {savedInputCandidates.map((item, index) => <div key={index}><small>Фрагмент {index + 1}</small><pre style={{ whiteSpace: "pre-wrap" }}>{item.text}</pre></div>)}
      </details>}
      {workflowError ? (
        <p className="error workflow-load-error" role="alert">
          {workflowError}{" "}
          <Button type="button" variant="text" onClick={() => void loadWorkflow()}>
            Повторить загрузку редакционного процесса
          </Button>
        </p>
      ) : null}
      {snapshot.captionpanels ? (
        <CaptionPanelsStatus storyId={storyId} state={snapshot.captionpanels} />
      ) : null}


      {editorToolsVisible ? <div id="scenario-editor-tools" className="editor-toolbar-sticky" style={{ top: toolbarTop }}>
        <div className="editor-toolbar-card">
          <div className="editor-toolbar-actions">
            <ScenarioHistoryControls
              canUndo={historyState.past.length > 0}
              canRedo={historyState.future.length > 0}
              disabled={Boolean(controlsReadOnly) || Boolean(dragState)}
              onUndo={undo}
              onRedo={redo}
            />
            <div className="scenario-search-entry-points" role="group" aria-label="Поиск по сценарию">
              <Button
                type="button"
                variant="text"
                className="editor-quiet-button"
                data-scenario-intent="find"
                title="Найти (Cmd/Ctrl+F)"
                onClick={(event) => openSearch("find", event.currentTarget)}
              >
                <ScenarioIcon name="search" /> Найти
              </Button>
              <Button
                type="button"
                variant="text"
                className="editor-quiet-button"
                data-scenario-intent="replace"
                title="Найти и заменить (Cmd/Ctrl+H)"
                aria-label="Найти и заменить"
                disabled={Boolean(controlsReadOnly)}
                onClick={(event) => openSearch("replace", event.currentTarget)}
              >
                Заменить
              </Button>
            </div>
            {!controlsReadOnly ? (
              <div className="editor-table-toolbar">
                <div className="editor-add-block-buttons editor-add-block-buttons-inline">
                  {BLOCK_OPTIONS.map(({ value, label }) => (
                    <Button
                      key={value}
                      type="button"
                      variant="outlined"
                      className={`editor-add-block-button editor-add-block-button-${blockTypeTone(value)}`}
                      disabled={Boolean(dragState)}
                      onClick={() => addBlock(value)}
                    >
                      + {label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="scenario-default-font-control">
              <span>Шрифт сценария</span>
              <div className="scenario-default-font-options" role="group" aria-label="Шрифт сценария">
                {(["PT Sans", "Franklin Gothic Book"] as const).map((font) => (
                  <Button key={font} type="button" variant="text" disabled={Boolean(controlsReadOnly)}
                    aria-pressed={defaultFontFamily === font}
                    onClick={() => { if (font !== defaultFontFamily) commitMutation(
                      (current) => ({ ...current, default_font_family: font }), { kind: "formatting" }); }}>
                    {font}
                  </Button>
                ))}
              </div>
            </div>
            <Button
              type="button"
              variant="outlined"
              className="editor-docx-export-button"
              disabled={exporting}
              aria-busy={exporting}
              onClick={() => void handleDocxExport()}
            >
              <ScenarioIcon name="export" /> {exporting ? "Подготавливаем DOCX…" : "Экспорт DOCX"}
            </Button>
          </div>
          {searchMode ? (
            <ScenarioSearchPanel
              mode={searchMode}
              query={searchQuery}
              replacement={searchReplacement}
              matchCase={searchMatchCase}
              activeIndex={clampedSearchIndex}
              matches={searchMatches}
              editable={!controlsReadOnly}
              focusRequest={searchFocusRequest}
              onQueryChange={(query) => {
                setSearchQuery(query);
                setSearchActiveIndex(0);
              }}
              onReplacementChange={setSearchReplacement}
              onMatchCaseChange={(matchCase) => {
                setSearchMatchCase(matchCase);
                setSearchActiveIndex(0);
              }}
              onPrevious={() => navigateSearch(-1)}
              onNext={() => navigateSearch(1)}
              onReplace={replaceActiveSearchMatch}
              onReplaceAll={replaceAllSearchMatches}
              onClose={closeSearch}
            />
          ) : null}
          {!controlsReadOnly ? (
            <div className="editor-format-toolbar" role="toolbar" aria-label="Форматирование">
              <div className="editor-format-toolbar-row editor-format-toolbar-row-inline">
                <div className="editor-format-inline-group">
                  <span className="editor-format-inline-label">Фрагмент</span>
                  <select
                    className="editor-format-font-select"
                    aria-label={formatScope
                      ? `Шрифт для ${formatScope.label} блока ${formatScope.rowIndex + 1}`
                      : "Шрифт"}
                    value={formatScope?.fontOverride || ""}
                    disabled={!formatScope}
                    onChange={(event) => applyFormatting({ font_family: event.target.value })}
                  >
                    <option value="">Основной ({defaultFontFamily})</option>
                    {FONT_OPTIONS.map((font) => <option key={font}>{font}</option>)}
                  </select>
                </div>
                <div className="editor-format-buttons">
                    <IconButton
                      type="button"
                      aria-label={formatScope
                        ? `Жирный для ${formatScope.label} блока ${formatScope.rowIndex + 1}`
                        : "Жирный"}
                      aria-pressed={Boolean(formatScope?.config.bold)}
                      disabled={!formatScope}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFormatting({ bold: !formatScope?.config.bold })}
                    >
                      <b aria-hidden="true">B</b>
                    </IconButton>
                    <IconButton
                      type="button"
                      aria-label={formatScope
                        ? `Курсив для ${formatScope.label} блока ${formatScope.rowIndex + 1}`
                        : "Курсив"}
                      aria-pressed={Boolean(formatScope?.config.italic)}
                      disabled={!formatScope}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFormatting({ italic: !formatScope?.config.italic })}
                    >
                      <i aria-hidden="true">I</i>
                    </IconButton>
                    <IconButton
                      type="button"
                      aria-label={formatScope
                        ? `Зачеркнуть для ${formatScope.label} блока ${formatScope.rowIndex + 1}`
                        : "Зачеркнуть"}
                      aria-pressed={Boolean(formatScope?.config.strikethrough)}
                      disabled={!formatScope}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFormatting({
                        strikethrough: !formatScope?.config.strikethrough,
                      })}
                    >
                      <s aria-hidden="true">S</s>
                    </IconButton>
                </div>
                <div className="editor-color-palette">
                    <span className="editor-palette-label">Заливка</span>
                    {FILL_COLOR_OPTIONS.map(({ value, label }) => (
                      <IconButton
                        key={value}
                        type="button"
                        disableRipple
                        className={`editor-color-swatch${
                          formatScope?.config.fill_color === value ? " active" : ""
                        }`}
                        aria-label={formatScope
                          ? `${label} для ${formatScope.label} блока ${formatScope.rowIndex + 1}`
                          : label}
                        aria-pressed={formatScope?.config.fill_color === value}
                        disabled={!formatScope}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyFormatting(
                          { fill_color: value },
                          { collapseSelection: true },
                        )}
                      ><span aria-hidden="true" style={{ backgroundColor: value }} /></IconButton>
                    ))}
                </div>
                    <Button
                      type="button"
                      variant="text"
                      className="editor-quiet-button"
                      disabled={!formatScope}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFormatting({
                        bold: false,
                        italic: false,
                        strikethrough: false,
                      }, { reset: true })}
                    >
                      Сброс
                    </Button>
              <div className="editor-format-toolbar-head">

                <span className="small muted">
                  {formatScope
                    ? `Строка ${formatScope.rowIndex + 1}: ${formatScope.label}`
                    : "Выберите строку и поле"}
                </span>
              </div>
                <Button
                  type="button"
                  variant="text"
                  color="error"
                  className="editor-delete-selected"
                  disabled={Boolean(dragState) || selectedRowIds.length === 0}
                  onClick={deleteSelectedRows}
                >
                  <ScenarioIcon name="trash" /> Удалить выбранные
                </Button>
              </div>
            </div>
          ) : null}
          {exportError ? (
            <p className="error editor-docx-export-error" role="alert">
              {exportError}
            </p>
          ) : null}
        </div>
      </div> : null}

      <section className="editor-script-panel" aria-label="Таблица сценария">
        {snapshot.story.id === storyId
        && snapshot.story.rubric
        && exportMetadataCoordinator ? (
          <ScenarioMetadataHeader
            key={storyId}
            storyId={storyId}
            coordinator={exportMetadataCoordinator}
            story={{ ...snapshot.story, rubric: snapshot.story.rubric }}
            editable={Boolean(snapshot.metadata?.editable) && !controlsReadOnly}
            rubrics={snapshot.metadata?.rubrics || [snapshot.story.rubric]}
            onChanged={handleStoryMetadataChanged}
          />
        ) : null}
        <div className="editor-table-wrap">
        <table className="editor-table">
          <colgroup>
            {EDITOR_COLUMNS.map(({ key }) => (
              <col key={key} style={{ width: `${columnWidths[key]}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {EDITOR_COLUMNS.map(({ key, label }) => (
                <th key={key}>
                  <div className="editor-header-cell">
                    <span>{label}</span>
                    <button
                      type="button"
                      className="editor-column-resizer"
                      aria-label={`Изменить ширину столбца ${label}`}
                      onPointerDown={(event) => handleColumnResizeStart(key, event)}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <ScenarioRowComponent
                key={row.segment_uid}
                row={row}
                defaultFontFamily={defaultFontFamily}
                index={index}
                rowCount={rows.length}
                readOnly={Boolean(controlsReadOnly)}
                dragging={dragState?.sourceUid === row.segment_uid}
                structuralActionsDisabled={Boolean(dragState)}
                dropEdge={dragState?.targetUid === row.segment_uid ? dragState.edge : null}
                onDragPointerDown={(event) => handleDragPointerDown(row.segment_uid, event)}
                selected={selectedRowIds.includes(row.segment_uid)}
                focusRequest={focusRequest}
                onSelect={(multi, force) => selectRow(row.segment_uid, multi, force)}
                onRequestFocus={requestEditorFocus}
                onFormatScopeChange={setFormatScope}
                onEditorRegister={handleEditorRegister}
                onHistoryFocusBoundary={breakHistoryGroup}
                onChange={(next, meta) => mutate((current) => current.map((item) =>
                  item.segment_uid === row.segment_uid ? next : item), meta)}
                onDuplicate={() => {
                  const duplicate = cloneScenarioRow(row);
                  duplicate.segment_uid = createSegmentUid();
                  if (!mutate((current) => {
                    const sourceIndex = current.findIndex(
                      (item) => item.segment_uid === row.segment_uid,
                    );
                    return sourceIndex < 0
                      ? current
                      : [
                          ...current.slice(0, sourceIndex + 1),
                          duplicate,
                          ...current.slice(sourceIndex + 1),
                        ];
                  }, { kind: "structure" })) return;
                  setSelectedRowIds([duplicate.segment_uid]);
                  requestEditorFocus(
                    duplicate.segment_uid,
                    preferredFocusTarget(duplicate.block_type),
                  );
                }}
                onMove={(direction) => {
                  if (!mutate((current) => {
                    const sourceIndex = current.findIndex(
                      (item) => item.segment_uid === row.segment_uid,
                    );
                    const target = sourceIndex + direction;
                    if (sourceIndex < 0 || target < 0 || target >= current.length) return current;
                    const next = [...current];
                    [next[sourceIndex], next[target]] = [next[target], next[sourceIndex]];
                    return next;
                  }, { kind: "structure" })) return;
                  setSelectedRowIds([row.segment_uid]);
                  requestEditorFocus(
                    row.segment_uid,
                    formatScope?.segmentUid === row.segment_uid
                      ? formatScope.target
                      : preferredFocusTarget(row.block_type),
                  );
                }}
                onDelete={() => {
                  const current = contentRef.current.rows;
                  const sourceIndex = current.findIndex(
                    (item) => item.segment_uid === row.segment_uid,
                  );
                  const remaining = ensureEditableRows(current.filter(
                    (item) => item.segment_uid !== row.segment_uid,
                  ));
                  const nextRow = remaining[Math.min(
                    Math.max(sourceIndex, 0),
                    remaining.length - 1,
                  )];
                  if (!mutate(() => remaining, { kind: "structure" })) return;
                  setSelectedRowIds([nextRow.segment_uid]);
                  requestEditorFocus(
                    nextRow.segment_uid,
                    preferredFocusTarget(nextRow.block_type),
                  );
                }}
              />
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </section>
    </ScenarioAccessContext.Provider>
  );
}

export { DEFAULT_EDITOR_COLUMN_WIDTHS };
