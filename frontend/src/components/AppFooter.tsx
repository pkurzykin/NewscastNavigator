import { APP_VERSION } from "../appVersion";

export default function AppFooter() {
  return (
    <footer className="app-footer">
      Newscast Navigator v{APP_VERSION} · © 2026 Павел Курзыкин. Все права защищены.
    </footer>
  );
}
