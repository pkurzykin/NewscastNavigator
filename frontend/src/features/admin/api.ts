import { apiRequest } from "../../shared/api/client";
import type { CommandAck } from "../../shared/contracts";
import type {
  AdminUsersResponse,
  CreateAdminUserPayload,
  ResetAdminUserPasswordPayload,
  UpdateAdminUserPayload,
} from "./types";

export function fetchAdminUsers(): Promise<AdminUsersResponse> {
  return apiRequest<AdminUsersResponse>("/api/v1/admin/users");
}

export function createAdminUser(payload: CreateAdminUserPayload): Promise<CommandAck> {
  return apiRequest<CommandAck>("/api/v1/admin/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAdminUser(
  userId: number,
  payload: UpdateAdminUserPayload,
): Promise<CommandAck> {
  return apiRequest<CommandAck>(`/api/v1/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function resetAdminUserPassword(
  userId: number,
  payload: ResetAdminUserPasswordPayload,
): Promise<CommandAck> {
  return apiRequest<CommandAck>(`/api/v1/admin/users/${userId}/reset-password`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
