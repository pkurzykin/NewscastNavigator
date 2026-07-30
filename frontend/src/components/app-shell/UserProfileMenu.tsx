import type { CurrentUser } from "../../shared/contracts";

interface UserProfileMenuProps {
  user: CurrentUser;
  onOpenChangePassword: () => void;
  onLogout: () => void;
}

export default function UserProfileMenu({
  user,
  onOpenChangePassword,
  onLogout,
}: UserProfileMenuProps) {
  return (
    <div className="app-shell-user" role="group" aria-label="Профиль пользователя">
      <div className="app-shell-user-meta">
        <strong>{user.display_name || user.username}</strong>
        <span>{user.position}</span>
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
