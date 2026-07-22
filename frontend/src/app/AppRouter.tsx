import { useEffect, useState } from "react";

import AppShell, { type AppShellSection } from "../components/app-shell/AppShell";
import type { CurrentUser } from "../shared/contracts";
import AdminUsersPage from "../pages/AdminUsersPage";
import ArchivePage from "../pages/ArchivePage";
import StoriesPage from "../pages/StoriesPage";
import StoryHistoryPage from "../pages/StoryHistoryPage";
import StoryProductionPage from "../pages/StoryProductionPage";
import StoryScenarioPage from "../pages/StoryScenarioPage";

function currentLocationHref(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function navigate(path: string): void {
  const url = new URL(path, window.location.origin);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (currentLocationHref() === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useLocationHref(): string {
  const [locationHref, setLocationHref] = useState(currentLocationHref);
  useEffect(() => {
    const updateLocation = () => setLocationHref(currentLocationHref());
    window.addEventListener("popstate", updateLocation);
    const interceptLinks = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest("a[href]");
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(anchor.getAttribute("href") || "", window.location.origin);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/")) return;
      event.preventDefault();
      navigate(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", interceptLinks);
    return () => {
      window.removeEventListener("popstate", updateLocation);
      document.removeEventListener("click", interceptLinks);
    };
  }, []);
  return locationHref;
}

function sectionForPath(pathname: string): AppShellSection {
  if (pathname === "/archive") return "archive";
  if (pathname === "/admin") return "admin";
  if (pathname.startsWith("/stories/")) return "story";
  return "stories";
}

interface AppRouterProps {
  user: CurrentUser;
  onOpenChangePassword: () => void;
  onLogout: () => void;
}

export default function AppRouter({ user, onOpenChangePassword, onLogout }: AppRouterProps) {
  const locationHref = useLocationHref();
  const pathname = new URL(locationHref, window.location.origin).pathname;
  const storyMatch = pathname.match(/^\/stories\/(\d+)\/(scenario|production|history)$/);
  const canManageUsers = user.function_codes.includes("chief");
  let content: React.ReactNode;

  if (pathname === "/stories" || pathname === "/") {
    content = <StoriesPage onOpenScenario={(storyId) => navigate(`/stories/${storyId}/scenario`)} />;
  } else if (pathname === "/archive") {
    content = <ArchivePage onOpenScenario={(storyId) => navigate(`/stories/${storyId}/scenario`)} />;
  } else if (storyMatch) {
    const storyId = Number(storyMatch[1]);
    content = storyMatch[2] === "history"
      ? <StoryHistoryPage storyId={storyId} />
      : storyMatch[2] === "production"
        ? <StoryProductionPage storyId={storyId} />
        : <StoryScenarioPage storyId={storyId} activeTab="scenario" userId={user.id} locationKey={locationHref} />;
  } else if (pathname === "/admin" && canManageUsers) {
    content = <AdminUsersPage user={user} />;
  } else {
    content = <p className="error" role="alert">Страница не найдена</p>;
  }

  return (
    <AppShell
      user={user}
      activeSection={sectionForPath(pathname)}
      canManageUsers={canManageUsers}
      onOpenChangePassword={onOpenChangePassword}
      onLogout={onLogout}
    >
      {content}
    </AppShell>
  );
}
