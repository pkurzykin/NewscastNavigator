import { userRoleLabel } from "../shared/labels";
import type { UserPublic } from "../shared/types";

interface UserProfileMenuProps {
  user: UserPublic;
  onLogout: () => void;
  onOpenChangePassword: () => void;
}

export default function UserProfileMenu({
  user,
  onLogout,
  onOpenChangePassword,
}: UserProfileMenuProps) {
  const displayName = user.full_name || user.username;

  return (
    <div className="user-profile-menu">
      <div>
        <strong>{displayName}</strong>
        <span>{userRoleLabel(user.role)}</span>
      </div>
      {user.must_change_password ? (
        <div className="user-profile-alert">Нужно сменить временный пароль</div>
      ) : null}
      <div className="user-profile-actions">
        <button className="text-button" type="button" onClick={onOpenChangePassword}>
          Сменить пароль
        </button>
        <button className="text-button" type="button" onClick={onLogout}>
          Выйти
        </button>
      </div>
    </div>
  );
}
