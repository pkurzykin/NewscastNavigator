import { useState } from "react";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
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
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const name = user.display_name.trim() || user.username;
  return (
    <div className="app-shell-user" role="group" aria-label="Профиль пользователя">
      <Button className="app-shell-profile-toggle" aria-label={`Профиль: ${name}`} aria-haspopup="menu" aria-expanded={Boolean(anchor)} aria-controls={anchor ? "profile-menu" : undefined} onClick={(event) => setAnchor(event.currentTarget)}>
        <span className="app-shell-user-meta"><strong>{name}</strong><span>{user.position}</span></span>
        <span aria-hidden="true" className="profile-chevron">⌄</span>
      </Button>
      <Menu id="profile-menu" anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => { setAnchor(null); onOpenChangePassword(); }}>Сменить пароль</MenuItem>
        <MenuItem onClick={() => { setAnchor(null); onLogout(); }}>Выйти</MenuItem>
      </Menu>
    </div>
  );
}
