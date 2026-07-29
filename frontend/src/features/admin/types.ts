import type { CodeLabel } from "../../shared/contracts";

export interface AdminUserItem {
  id: number;
  username: string;
  display_name: string;
  position: string;
  function_codes: string[];
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminUsersResponse {
  items: AdminUserItem[];
  function_options: CodeLabel[];
}

export interface CreateAdminUserPayload {
  username: string;
  display_name: string;
  position: string;
  function_codes: string[];
  temporary_password: string;
}

export interface UpdateAdminUserPayload {
  display_name?: string;
  position?: string;
  function_codes?: string[];
  is_active?: boolean;
}

export interface ResetAdminUserPasswordPayload {
  temporary_password: string;
}
