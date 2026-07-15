import type { UserRef } from "../../shared/contracts";


export interface WorkflowMark {
  revision: number;
  actor: UserRef;
  at: string;
}

export interface WorkflowAction {
  code: string;
  label: string;
  method: "POST";
  href: string;
  emphasis: "primary" | "normal" | "danger";
  confirmation: string | null;
  form: null | "correction_package" | "external_result" | "return_reason";
}

export interface WorkflowReadModel {
  story_id: number;
  review_request: WorkflowMark | null;
  editorial_check: WorkflowMark | null;
  proofread: WorkflowMark | null;
  changed_after_proofread: boolean;
  reproofread_request: WorkflowMark | null;
  primary_action: WorkflowAction | null;
  additional_actions: WorkflowAction[];
}
