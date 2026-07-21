import type { AssignmentRef, CodeLabel, RubricRef, UserRef } from "../../shared/contracts";


export interface ProductionAction {
  code: string;
  label: string;
  method: "POST";
  href: string;
  emphasis: "primary" | "normal" | "danger";
  confirmation: string | null;
  form: null | "correction_package" | "external_result" | "return_reason";
}

export interface ProductionStoryHeader {
  id: number;
  title: string;
  priority: CodeLabel;
  rubric: RubricRef;
  author: UserRef;
  situation: CodeLabel;
  assignments: AssignmentRef[];
  created_at: string;
  aired_at: string | null;
  archived_at: string | null;
  primary_action: ProductionAction | null;
  additional_actions: ProductionAction[];
}

export interface ProductionMaterial {
  id: number;
  title: string;
  location: string;
  added_by: UserRef;
  added_at: string;
}

export interface ProductionStage {
  code: string;
  state: string;
  label: string;
  summary: string;
}

export interface ProductionReadModel {
  story: ProductionStoryHeader;
  scenario_revision: number;
  assignments: AssignmentRef[];
  assignee_options: UserRef[];
  can_manage_assignments: boolean;
  materials: ProductionMaterial[];
  voiceover: {
    ready: boolean;
    ready_by: UserRef | null;
    ready_at: string | null;
  };
  video: {
    started_by: UserRef | null;
    started_at: string | null;
    ready_by: UserRef | null;
    ready_at: string | null;
    approved_for_titles_by: UserRef | null;
    approved_for_titles_at: string | null;
    last_opened_revision: number | null;
    has_unseen_scenario_changes: boolean;
  };
  titles: {
    initial_gate_satisfied: boolean;
    started_by: UserRef | null;
    started_at: string | null;
    ready_by: UserRef | null;
    ready_at: string | null;
    accepted_by: UserRef | null;
    accepted_at: string | null;
    last_opened_revision: number | null;
    has_unseen_scenario_changes: boolean;
  };
  aired: null | { by: UserRef; at: string };
  stages: ProductionStage[];
  primary_action: ProductionAction | null;
  additional_actions: ProductionAction[];
}
