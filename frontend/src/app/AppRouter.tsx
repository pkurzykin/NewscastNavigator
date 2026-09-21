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
  cancelPendingNavigationConfirmation,
  hasBlockedNavigation,
  INTERNAL_NAVIGATION_EVENT,
  requestNavigation,
} from "./navigationGuard";
import NavigationConfirmationDialog from "./NavigationConfirmationDialog";

function currentLocationHref(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export const HISTORY_POSITION_KEY = "newscastNavigationPosition";

function historyPosition(): number | null {
  const value = window.history.state?.[HISTORY_POSITION_KEY];
  return typeof value === "number" ? value : null;
}

function ensureHistoryPosition(): number {
  const existing = historyPosition();
  if (existing !== null) return existing;
  window.history.replaceState(
    { ...(window.history.state ?? {}), [HISTORY_POSITION_KEY]: 0 },
    "",
    currentLocationHref(),
  );
  return 0;
}

export function navigate(path: string): boolean {
  const url = new URL(path, window.location.href);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (currentLocationHref() === next) return true;
  return requestNavigation(() => {
    const position = (historyPosition() ?? 0) + 1;
    window.history.pushState({ [HISTORY_POSITION_KEY]: position }, "", next);
    window.dispatchEvent(new Event(INTERNAL_NAVIGATION_EVENT));
  });
}

export function useLocationHref(): string {
  const [locationHref, setLocationHref] = useState(currentLocationHref);
  const acceptedLocationRef = useRef(currentLocationHref());
  const acceptedPositionRef = useRef(ensureHistoryPosition());
  const restoringHistoryRef = useRef(false);
  const popNavigationSequenceRef = useRef(0);
  const focusBeforeLinkRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const acceptInternalNavigation = () => {
      const next = currentLocationHref();
      acceptedLocationRef.current = next;
      acceptedPositionRef.current = ensureHistoryPosition();
      setLocationHref(next);
    };
    const handlePopState = () => {
      const sequence = ++popNavigationSequenceRef.current;
      if (restoringHistoryRef.current) {
        restoringHistoryRef.current = false;
        return;
      }
      const next = currentLocationHref();
      const previous = acceptedLocationRef.current;
      if (next === previous) {
        cancelPendingNavigationConfirmation();
        return;
      }
      const nextPosition = historyPosition();
      const previousPosition = acceptedPositionRef.current;
      if (!hasBlockedNavigation()) {
        acceptedLocationRef.current = next;
        if (nextPosition !== null) acceptedPositionRef.current = nextPosition;
        setLocationHref(next);
        return;
      }
      requestNavigation(() => {
        if (
          popNavigationSequenceRef.current !== sequence
          || currentLocationHref() !== next
        ) return;
        acceptedLocationRef.current = next;
        if (nextPosition !== null) acceptedPositionRef.current = nextPosition;
        setLocationHref(next);
      }, () => {
        if (
          popNavigationSequenceRef.current !== sequence
          || currentLocationHref() !== next
        ) return;
        if (nextPosition !== null && nextPosition !== previousPosition) {
          restoringHistoryRef.current = true;
          window.history.go(previousPosition - nextPosition);
          return;
        }
        window.history.pushState(
          { ...(window.history.state ?? {}), [HISTORY_POSITION_KEY]: previousPosition },
          "",
          previous,
        );
      });
    };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener(INTERNAL_NAVIGATION_EVENT, acceptInternalNavigation);
    const internalAnchorFor = (target: EventTarget | null) => {
      const anchor = target instanceof Element
        ? target.closest<HTMLAnchorElement>("a[href]")
        : null;
      if (!anchor) return null;
      const url = new URL(anchor.getAttribute("href") || "", window.location.href);
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
      const url = new URL(anchor.getAttribute("href") || "", window.location.href);
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
        : <StoryScenarioPage storyId={storyId} activeTab="scenario" userId={user.id} userFunctions={user.function_codes} locationKey={locationHref} />;
  } else if (pathname === "/admin" && canManageUsers) {
    content = <AdminUsersPage user={user} />;
  } else {
    content = <p className="error" role="alert">Страница не найдена</p>;
  }

  return (
    <>
      <AppShell
        user={user}
        activeSection={sectionForPath(pathname)}
        canManageUsers={canManageUsers}
        onOpenChangePassword={onOpenChangePassword}
        onLogout={onLogout}
      >
        {content}
      </AppShell>
      <NavigationConfirmationDialog />
    </>
  );
}
