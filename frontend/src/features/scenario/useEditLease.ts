import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { acquireScenarioLease, heartbeatScenarioLease, releaseScenarioLease } from "./api";
import { EditLeaseController } from "./editLeaseController";

const transport = {
  acquire: acquireScenarioLease,
  heartbeat: heartbeatScenarioLease,
  release: releaseScenarioLease,
};

export function useEditLease(storyId: number) {
  const controller = useMemo(() => new EditLeaseController(storyId, transport), [storyId]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  const releaseForPageExit = useCallback(() => {
    void controller.suspend();
  }, [controller]);

  const resumeFromPageCache = useCallback((event: PageTransitionEvent) => {
    controller.resumeFromPageCache(event.persisted);
  }, [controller]);

  useEffect(() => {
    controller.activateForMount();
    const timer = window.setInterval(controller.heartbeatTick, 30_000);
    window.addEventListener("pagehide", releaseForPageExit);
    window.addEventListener("pageshow", resumeFromPageCache);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", releaseForPageExit);
      window.removeEventListener("pageshow", resumeFromPageCache);
      releaseForPageExit();
    };
  }, [controller, releaseForPageExit, resumeFromPageCache]);

  return {
    lease: snapshot.lease,
    error: snapshot.error,
    resumeVersion: snapshot.resumeVersion,
    acquire: controller.acquire,
    release: controller.release,
    touch: controller.touch,
  };
}
