import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";

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

function createHandoffGate(): HandoffGate {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

export class EditLeaseHandoffCoordinator {
  private latestDrain: Promise<void> = Promise.resolve();

  bind(gate: HandoffGate) {
    const drain = this.latestDrain;
    void drain.then(gate.resolve, gate.resolve);
  }

  registerDrain(drain: Promise<void>) {
    this.latestDrain = drain.catch(() => undefined);
  }
}

export function useEditLease(storyId: number, parentCoordinator?: EditLeaseHandoffCoordinator) {
  const localCoordinator = useMemo(() => new EditLeaseHandoffCoordinator(), []);
  const coordinator = parentCoordinator ?? localCoordinator;
  const gate = useMemo(() => createHandoffGate(), [coordinator, storyId]);
  const controller = useMemo(
    () => new EditLeaseController(storyId, transport, gate.promise),
    [gate, storyId],
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  const releaseForPageExit = useCallback(() => {
    void controller.suspend();
  }, [controller]);

  const resumeFromPageCache = useCallback((event: PageTransitionEvent) => {
    controller.resumeFromPageCache(event.persisted);
  }, [controller]);

  useLayoutEffect(() => {
    controller.activateForMount();
    coordinator.bind(gate);
    const timer = window.setInterval(controller.heartbeatTick, 30_000);
    window.addEventListener("pagehide", releaseForPageExit);
    window.addEventListener("pageshow", resumeFromPageCache);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", releaseForPageExit);
      window.removeEventListener("pageshow", resumeFromPageCache);
      const drain = controller.suspend();
      coordinator.registerDrain(drain);
    };
  }, [controller, coordinator, gate, releaseForPageExit, resumeFromPageCache]);

  return {
    lease: snapshot.lease,
    error: snapshot.error,
    resumeVersion: snapshot.resumeVersion,
    acquire: controller.acquire,
    release: controller.release,
    touch: controller.touch,
  };
}
