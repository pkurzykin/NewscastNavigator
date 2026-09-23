import { useMemo, useState, type ReactNode } from "react";
import { Alert, Button } from "@mui/material";
import WorkflowSummary, { type WorkflowStage } from "./WorkflowSummary";

import { runWorkflowAction } from "../api";
import type { WorkflowAction, WorkflowReadModel } from "../types";


interface Props {
  workflow: WorkflowReadModel;
  revision: number;
  disabled?: boolean;
  beforeAction?: () => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
}

export default function WorkflowActions({ workflow, revision, disabled = false, beforeAction, onRefresh }: Props) {
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const actions = useMemo(
    () => [workflow.primary_action, ...workflow.additional_actions].filter(
      (action): action is WorkflowAction => action !== null,
    ),
    [workflow],
  );

  const execute = async (action: WorkflowAction) => {
    if (pendingCode !== null) return;
    setPendingCode(action.code);
    setError("");
    try {
      await beforeAction?.();
      await runWorkflowAction(action, revision);
      await onRefresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось выполнить действие. Повторите попытку.");
    } finally {
      setPendingCode(null);
    }
  };

  const controls: Partial<Record<WorkflowStage, ReactNode[]>> = {};
  for (const action of actions) {
    const stage: WorkflowStage = action.code === "submit_review" ? "review"
      : ["mark_proofread", "request_reproofread"].includes(action.code) ? "proofread" : "editorial";
    (controls[stage] ??= []).push(
      <Button key={action.code}
        variant={action.emphasis === "primary" ? "contained" : "outlined"}
        size="small"
        disabled={disabled || pendingCode !== null}
        onClick={() => void execute(action)}>
        {action.code === "mark_proofread" ? "Отметить вычитанным" : action.label}
      </Button>,
    );
  }
  return <WorkflowSummary workflow={workflow} actions={controls}
    error={error ? <Alert severity="error">{error} Можно повторить действие.</Alert> : undefined} />;
}
