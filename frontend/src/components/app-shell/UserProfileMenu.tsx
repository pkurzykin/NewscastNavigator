import { userRoleLabel } from "../../shared/labels";
import type { UserPublic } from "../../shared/types";

interface UserProfileMenuProps {
  user: UserPublic;
  onOpenChangePassword: () => void;
  onLogout: () => void;
}

export default function UserProfileMenu({
  user,
  onOpenChangePassword,
  onLogout,
}: UserProfileMenuProps) {
  return (
    <div className="app-shell-user" aria-label="Профиль пользователя">
      <div className="app-shell-user-meta">
        <strong>{user.full_name || user.username}</strong>
        <span>
          {userRoleLabel(user.role)}
          {user.job_title ? ` · ${user.job_title}` : ""}
        </span>
      </div>
      <div className="app-shell-user-actions">
        <button type="button" className="secondary" onClick={onOpenChangePassword}>
          Пароль
        </button>
        <button type="button" className="secondary" onClick={onLogout}>
          Выйти
        </button>
      </div>
    </div>
  );
}
