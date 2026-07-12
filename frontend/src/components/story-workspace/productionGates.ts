import { finalReviewStatusLabel, trackStatusLabel } from "../../shared/labels";
import type { ProjectListItem } from "../../shared/types";

export type ProductionGateKey = "text_ready" | "voiceover_ready" | "edit_review" | "titles" | "titles_review" | "external_approval";
export type ProductionGateStatus = "done" | "current" | "blocked" | "attention";

export interface ProductionGate {
  key: ProductionGateKey;
  label: string;
  status: ProductionGateStatus;
  summary: string;
  detail: string;
  actionLabel: string;
}

function seqLabel(seq?: number | null): string { return seq ? `#${seq}` : "-"; }
function isTrackDone(status?: string | null): boolean { return (status || "").trim().toLowerCase() === "done"; }
function isTrackInProgress(status?: string | null): boolean { const normalized = (status || "").trim().toLowerCase(); return normalized === "in_progress" || normalized === "review"; }
function isTrackInReview(status?: string | null): boolean { return (status || "").trim().toLowerCase() === "review"; }
function isTrackInTrouble(status?: string | null): boolean { return (status || "").trim().toLowerCase() === "changes_requested"; }
function isFinalApprovalDone(status?: string | null): boolean { return (status || "").trim().toLowerCase() === "approved"; }
function isFinalApprovalActive(status?: string | null): boolean { const normalized = (status || "").trim().toLowerCase(); return normalized === "submitted" || normalized === "changes_requested"; }
function isFinalApprovalReadyToStart(status?: string | null): boolean { const normalized = (status || "").trim().toLowerCase(); return normalized === "" || normalized === "not_started"; }

export function buildProductionGates(project: ProjectListItem): ProductionGate[] {
  const textReady = Boolean(project.current_text_seq && project.current_text_is_latest && project.proofread_text_seq && project.latest_text_is_proofread);
  const textNeedsAttention = Boolean(project.current_text_seq && (!project.current_text_is_latest || !project.latest_text_is_proofread));
  const voiceoverReady = Boolean(project.voiceover_text_seq && isTrackDone(project.voiceover_status) && !project.voiceover_requires_resync);
  const voiceoverNeedsAttention = Boolean(project.voiceover_requires_resync || isTrackInTrouble(project.voiceover_status));
  const editReady = Boolean(project.edit_text_seq && isTrackDone(project.edit_status) && !project.edit_requires_resync);
  const editNeedsAttention = Boolean(project.edit_requires_resync || isTrackInTrouble(project.edit_status));
  const titlesStarted = Boolean(project.titles_text_seq || isTrackInProgress(project.titles_status));
  const finalTitlesStarted = Boolean(editReady && titlesStarted);
  const titlesReadyForReview = Boolean(editReady && project.titles_text_seq && (isTrackDone(project.titles_status) || isTrackInReview(project.titles_status)) && !project.titles_requires_resync);
  const titlesDone = Boolean(editReady && project.titles_text_seq && isTrackDone(project.titles_status) && !project.titles_requires_resync);
  const titlesNeedAttention = Boolean(project.titles_requires_resync || isTrackInTrouble(project.titles_status));
  const finalApprovalDone = isFinalApprovalDone(project.final_review_status);
  const finalApprovalNeedsAttention = (project.final_review_status || "").trim().toLowerCase() === "changes_requested";
  const gates: ProductionGate[] = [
    { key: "text_ready", label: "Текст готов", status: textReady ? "done" : textNeedsAttention ? "attention" : "current", summary: textReady ? "Текущий и вычитанный" : "Нужен готовый текст", detail: `Текущий ${seqLabel(project.current_text_seq)} · вычитанный ${seqLabel(project.proofread_text_seq)}`, actionLabel: textReady ? "Текст можно отдавать в производство" : "Подготовить текущий вычитанный текст" },
    { key: "voiceover_ready", label: "Озвучка готова", status: voiceoverReady ? "done" : voiceoverNeedsAttention ? "attention" : textReady ? "current" : "blocked", summary: voiceoverReady ? "Готовая озвучка" : trackStatusLabel(project.voiceover_status), detail: `Озвучка ${seqLabel(project.voiceover_text_seq)} · вычитка ${seqLabel(project.proofread_text_seq)}`, actionLabel: voiceoverReady ? "Озвучка актуальна" : "Получить или обновить озвучку" },
    { key: "edit_review", label: "Проверка монтажа", status: editReady ? "done" : editNeedsAttention ? "attention" : voiceoverReady ? "current" : "blocked", summary: editReady ? "Монтаж OK" : trackStatusLabel(project.edit_status), detail: `Монтаж ${seqLabel(project.edit_text_seq)} · текущий текст ${seqLabel(project.current_text_seq)}`, actionLabel: editReady ? "Монтаж принят" : "Монтаж OK или зафиксировать правки" },
    { key: "titles", label: "Титры", status: finalTitlesStarted ? titlesNeedAttention ? "attention" : "done" : editReady ? "current" : "blocked", summary: finalTitlesStarted ? trackStatusLabel(project.titles_status) : titlesStarted ? "Черновые титры" : "Ждут монтаж OK", detail: `Титры ${seqLabel(project.titles_text_seq)} · вычитка ${seqLabel(project.proofread_text_seq)}`, actionLabel: editReady ? "Передать в титры" : "Финальные титры после принятого монтажа" },
    { key: "titles_review", label: "Проверка титров", status: titlesDone ? "done" : editReady && titlesNeedAttention ? "attention" : titlesReadyForReview ? "current" : "blocked", summary: titlesDone ? "Титры OK" : trackStatusLabel(project.titles_status), detail: `Титры ${seqLabel(project.titles_text_seq)} · текущий текст ${seqLabel(project.current_text_seq)}`, actionLabel: titlesDone ? "Титры приняты" : "Проверить титры или зафиксировать правки" },
  ];
  if (titlesDone) gates.push({ key: "external_approval", label: "Внешнее согласование", status: titlesDone && finalApprovalDone ? "done" : titlesDone && finalApprovalNeedsAttention ? "attention" : titlesDone && (isFinalApprovalReadyToStart(project.final_review_status) || isFinalApprovalActive(project.final_review_status)) ? "current" : "blocked", summary: titlesDone && isFinalApprovalReadyToStart(project.final_review_status) ? "Можно отправлять" : finalReviewStatusLabel(project.final_review_status), detail: "В систему фиксируется только факт отправки и результат согласования.", actionLabel: finalApprovalDone ? "Сдано" : "Отметить отправку или зафиксировать результат" });
  return gates;
}

export function getCurrentProductionGate(project: ProjectListItem): ProductionGate {
  const gates = buildProductionGates(project);
  return gates.find((gate) => gate.status === "attention") || gates.find((gate) => gate.status === "current") || gates.find((gate) => gate.status === "blocked") || gates[gates.length - 1];
}
