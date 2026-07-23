import type { UserRef } from "../../shared/contracts";
import type { CorrectionPackagePartCreatePayload } from "../corrections/types";
import type { ProductionAction } from "../production/types";


export type ExternalApprovalResult = "pending" | "approved" | "changes_requested";

export interface ExternalApprovalCycle {
  id: number;
  cycle_no: number;
  sent_by: UserRef;
  sent_at: string;
  result: ExternalApprovalResult;
  decided_by: UserRef | null;
  decided_at: string | null;
  correction_package_id: number | null;
  primary_action: ProductionAction | null;
  additional_actions: ProductionAction[];
}

export interface ExternalApprovalReadModel {
  story_id: number;
  items: ExternalApprovalCycle[];
  assignee_options: UserRef[];
  send_action: ProductionAction | null;
}

export interface ExternalApprovalResultPayload {
  result: "approved" | "changes_requested";
  parts: CorrectionPackagePartCreatePayload[];
}
