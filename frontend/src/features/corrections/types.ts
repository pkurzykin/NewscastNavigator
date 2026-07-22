import type { UserRef } from "../../shared/contracts";
import type { ProductionAction } from "../production/types";


export type CorrectionScope = "text" | "video" | "titles" | "voiceover";

export interface CorrectionAction extends ProductionAction {
  part_id?: number | null;
  part_scope?: CorrectionScope | null;
}

export interface CorrectionPart {
  id: number;
  scope: CorrectionScope;
  description: string;
  assignee: UserRef;
  state: "pending" | "done";
  completed_by: UserRef | null;
  completed_at: string | null;
}

export interface CorrectionPackage {
  id: number;
  source: "internal" | "external";
  created_by: UserRef;
  created_at: string;
  parts: CorrectionPart[];
  all_parts_complete: boolean;
  awaiting_leadership_review: boolean;
  closed_by: UserRef | null;
  closed_at: string | null;
  primary_action: CorrectionAction | null;
  additional_actions: CorrectionAction[];
}

export interface CorrectionPackagesResponse {
  story_id: number;
  items: CorrectionPackage[];
  assignee_options: UserRef[];
  create_action: CorrectionAction | null;
}

export interface CorrectionPackagePartCreatePayload {
  scope: CorrectionScope;
  description: string;
  assignee_user_id: number;
}

export interface CorrectionPackageCreatePayload {
  source: "internal";
  parts: CorrectionPackagePartCreatePayload[];
}
