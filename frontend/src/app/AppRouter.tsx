import { useEffect, useRef, useState } from "react";

import AppShell, { type AppShellSection } from "../components/app-shell/AppShell";
import type { CurrentUser } from "../shared/contracts";
import AdminUsersPage from "../pages/AdminUsersPage";
import ArchivePage from "../pages/ArchivePage";
import StoriesPage from "../pages/StoriesPage";
import StoryHistoryPage from "../pages/StoryHistoryPage";
import StoryProductionPage from "../pages/StoryProductionPage";
import StoryScenarioPage from "../pages/StoryScenarioPage";
import {
  confirmNavigationAway,
  INTERNAL_NAVIGATION_EVENT,
} from "./navigationGuard";

function currentLocationHref(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function navigate(path: string): boolean {
  const url = new URL(path, window.location.origin);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (currentLocationHref() === next) return true;
  if (!confirmNavigationAway()) return false;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event(INTERNAL_NAVIGATION_EVENT));
  return true;
}

export function useLocationHref(): string {
  const [locationHref, setLocationHref] = useState(currentLocationHref);
  const acceptedLocationRef = useRef(currentLocationHref());
  const focusBeforeLinkRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const acceptInternalNavigation = () => {
      const next = currentLocationHref();
      acceptedLocationRef.current = next;
      setLocationHref(next);
    };
    const handlePopState = () => {
      const next = currentLocationHref();
      const previous = acceptedLocationRef.current;
      if (next === previous) return;
      if (!confirmNavigationAway()) {
        window.history.pushState({}, "", previous);
        return;
      }
      acceptedLocationRef.current = next;
      setLocationHref(next);
    };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener(INTERNAL_NAVIGATION_EVENT, acceptInternalNavigation);
    const internalAnchorFor = (target: EventTarget | null) => {
      const anchor = target instanceof Element
        ? target.closest<HTMLAnchorElement>("a[href]")
        : null;
      if (!anchor) return null;
      const url = new URL(anchor.getAttribute("href") || "", window.location.origin);
      return url.origin === window.location.origin && url.pathname.startsWith("/")
        ? anchor
        : null;
    };
    const rememberFocusBeforeLink = (event: PointerEvent) => {
      focusBeforeLinkRef.current = null;
      if (
        event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
        || !internalAnchorFor(event.target)
      ) {
        return;
      }
      focusBeforeLinkRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    };
    const interceptLinks = (event: MouseEvent) => {
      const anchor = internalAnchorFor(event.target);
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(anchor.getAttribute("href") || "", window.location.origin);
      event.preventDefault();
      const focusToRestore = focusBeforeLinkRef.current;
      focusBeforeLinkRef.current = null;
      if (!navigate(`${url.pathname}${url.search}${url.hash}`)) {
        focusToRestore?.focus();
      }
    };
    document.addEventListener("pointerdown", rememberFocusBeforeLink, true);
    document.addEventListener("click", interceptLinks);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener(INTERNAL_NAVIGATION_EVENT, acceptInternalNavigation);
      document.removeEventListener("pointerdown", rememberFocusBeforeLink, true);
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
