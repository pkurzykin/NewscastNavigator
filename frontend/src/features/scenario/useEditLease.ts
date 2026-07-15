import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { acquireScenarioLease, heartbeatScenarioLease, releaseScenarioLease } from "./api";
import { EditLeaseController } from "./editLeaseController";

const transport = {
  acquire: acquireScenarioLease,
  heartbeat: heartbeatScenarioLease,
  release: releaseScenarioLease,
};

interface HandoffGate {
  promise: Promise<void>;
  resolve: () => void;
}

interface ControllerEntry {
  controller: EditLeaseController;
  nextHandoff: HandoffGate | null;
}

function createHandoffGate(): HandoffGate {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

export function useEditLease(storyId: number) {
  const committedEntryRef = useRef<ControllerEntry | null>(null);
  const entry = useMemo<ControllerEntry>(() => {
    const previous = committedEntryRef.current;
    let initialBarrier = Promise.resolve();
    if (previous) {
      const handoff = createHandoffGate();
      previous.nextHandoff = handoff;
      initialBarrier = handoff.promise;
    }
    return {
      controller: new EditLeaseController(storyId, transport, initialBarrier),
      nextHandoff: null,
    };
  }, [storyId]);
  const { controller } = entry;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  const releaseForPageExit = useCallback(() => {
    void controller.suspend();
  }, [controller]);

  const resumeFromPageCache = useCallback((event: PageTransitionEvent) => {
    controller.resumeFromPageCache(event.persisted);
  }, [controller]);

  useLayoutEffect(() => {
    committedEntryRef.current = entry;
    controller.activateForMount();
    const timer = window.setInterval(controller.heartbeatTick, 30_000);
    window.addEventListener("pagehide", releaseForPageExit);
    window.addEventListener("pageshow", resumeFromPageCache);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", releaseForPageExit);
      window.removeEventListener("pageshow", resumeFromPageCache);
      const handoff = entry.nextHandoff;
      const drain = controller.suspend();
      if (handoff) void drain.then(handoff.resolve, handoff.resolve);
    };
  }, [controller, entry, releaseForPageExit, resumeFromPageCache]);

  return {
    lease: snapshot.lease,
    error: snapshot.error,
    resumeVersion: snapshot.resumeVersion,
    acquire: controller.acquire,
    release: controller.release,
    touch: controller.touch,
  };
}
