import { registerNavigationBlocker } from "../../app/navigationGuard";
import { updateStoryMetadata } from "../stories/api";

export interface MetadataValues {
  title: string;
  rubricId: number;
  durationText: string | null;
}

export interface MetadataPatch {
  title?: string;
  rubric_id?: number;
  duration_text?: string | null;
}

interface MetadataSnapshot {
  desired: MetadataValues;
  persisted: MetadataValues;
  error: string;
  ackVersion: number;
  lastAckPatch: MetadataPatch | null;
}

type Listener = () => void;

class MetadataSaveCoordinator {
  private readonly listeners = new Set<Listener>();
  private persisted: MetadataValues;
  private desired: MetadataValues;
  private queuedPatch: MetadataPatch | null = null;
  private inFlightPatch: MetadataPatch | null = null;
  private inFlight = false;
  private error = "";
  private ackVersion = 0;
  private lastAckPatch: MetadataPatch | null = null;
  private activated = false;
  private retainedAcrossUnmount = false;
  private unregisterNavigationBlocker: (() => void) | null = null;

  constructor(
    readonly storyId: number,
    initial: MetadataValues,
  ) {
    this.persisted = { ...initial };
    this.desired = { ...initial };
  }

  private isDirty = () => (
    this.inFlight
    || this.queuedPatch !== null
    || this.desired.title !== this.persisted.title
    || this.desired.rubricId !== this.persisted.rubricId
    || this.desired.durationText !== this.persisted.durationText
  );

  private warnBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!this.isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  };

  private activate() {
    if (this.activated) return;
    this.activated = true;
    this.unregisterNavigationBlocker = registerNavigationBlocker(this.isDirty);
    window.addEventListener("beforeunload", this.warnBeforeUnload);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: Listener): () => void {
    this.activate();
    this.retainedAcrossUnmount = false;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;
      if (this.isDirty()) {
        this.retainedAcrossUnmount = true;
        return;
      }
      removeMetadataSaveCoordinator(this);
    };
  }

  snapshot(): MetadataSnapshot {
    return {
      desired: { ...this.desired },
      persisted: { ...this.persisted },
      error: this.error,
      ackVersion: this.ackVersion,
      lastAckPatch: this.lastAckPatch ? { ...this.lastAckPatch } : null,
    };
  }

  setDesiredTitle(title: string) {
    this.desired.title = title;
    this.notify();
  }

  setDesiredRubric(rubricId: number) {
    this.desired.rubricId = rubricId;
    this.notify();
  }

  setDesiredDuration(durationText: string | null) {
    this.desired.durationText = durationText;
    this.notify();
  }

  private desiredPatch(): MetadataPatch {
    const projected = {
      title: this.inFlightPatch?.title ?? this.persisted.title,
      rubricId: this.inFlightPatch?.rubric_id ?? this.persisted.rubricId,
      durationText: this.inFlightPatch?.duration_text !== undefined
        ? this.inFlightPatch.duration_text
        : this.persisted.durationText,
    };
    return {
      ...(this.desired.title !== projected.title
        ? { title: this.desired.title }
        : {}),
      ...(this.desired.rubricId !== projected.rubricId
        ? { rubric_id: this.desired.rubricId }
        : {}),
      ...(this.desired.durationText !== projected.durationText
        ? { duration_text: this.desired.durationText }
        : {}),
    };
  }

  queueLatestDesired() {
    const latest = this.desiredPatch();
    if (
      latest.title === undefined
      && latest.rubric_id === undefined
      && latest.duration_text === undefined
    ) {
      this.queuedPatch = null;
      this.notify();
      return;
    }
    this.queuedPatch = latest;
    this.notify();
    void this.drainQueue();
  }

  retry() {
    this.error = "";
    this.queueLatestDesired();
  }

  setValidationError(message: string) {
    this.error = message;
    this.notify();
  }

  private async drainQueue(): Promise<void> {
    if (this.inFlight || this.queuedPatch === null) return;
    const candidate = this.queuedPatch;
    this.queuedPatch = null;
    const payload: MetadataPatch = {
      ...(candidate.title !== undefined && candidate.title !== this.persisted.title
        ? { title: candidate.title }
        : {}),
      ...(candidate.rubric_id !== undefined
        && candidate.rubric_id !== this.persisted.rubricId
        ? { rubric_id: candidate.rubric_id }
        : {}),
      ...(candidate.duration_text !== undefined
        && candidate.duration_text !== this.persisted.durationText
        ? { duration_text: candidate.duration_text }
        : {}),
    };
    if (
      payload.title === undefined
      && payload.rubric_id === undefined
      && payload.duration_text === undefined
    ) {
      this.error = "";
      this.notify();
      return;
    }

    this.inFlight = true;
    this.inFlightPatch = payload;
    this.notify();
    let succeeded = false;
    let receivedNewerPatch = false;
    try {
      await updateStoryMetadata(this.storyId, payload);
      if (payload.title !== undefined) this.persisted.title = payload.title;
      if (payload.rubric_id !== undefined) {
        this.persisted.rubricId = payload.rubric_id;
      }
      if (payload.duration_text !== undefined) {
        this.persisted.durationText = payload.duration_text;
      }
      this.error = "";
      this.ackVersion += 1;
      this.lastAckPatch = { ...payload };
      succeeded = true;
    } catch (requestError) {
      const newerPatch = this.queuedPatch;
      receivedNewerPatch = newerPatch !== null;
      this.queuedPatch = {
        ...payload,
        ...(newerPatch ?? {}),
      };
      this.error = requestError instanceof Error
        ? requestError.message
        : "Не удалось сохранить данные сюжета";
    } finally {
      this.inFlight = false;
      this.inFlightPatch = null;
      this.notify();
      if (this.queuedPatch !== null && (succeeded || receivedNewerPatch)) {
        void this.drainQueue();
      } else if (
        this.listeners.size === 0
        && !this.isDirty()
        && !this.retainedAcrossUnmount
      ) {
        removeMetadataSaveCoordinator(this);
      }
    }
  }

  dispose() {
    this.listeners.clear();
    this.unregisterNavigationBlocker?.();
    this.unregisterNavigationBlocker = null;
    if (this.activated) {
      window.removeEventListener("beforeunload", this.warnBeforeUnload);
    }
    this.activated = false;
  }
}

const coordinators = new Map<number, MetadataSaveCoordinator>();

function removeMetadataSaveCoordinator(coordinator: MetadataSaveCoordinator) {
  if (coordinators.get(coordinator.storyId) !== coordinator) return;
  coordinators.delete(coordinator.storyId);
  coordinator.dispose();
}

export function getMetadataSaveCoordinator(
  storyId: number,
  initial: MetadataValues,
): MetadataSaveCoordinator {
  const existing = coordinators.get(storyId);
  if (existing) return existing;
  const coordinator = new MetadataSaveCoordinator(storyId, initial);
  coordinators.set(storyId, coordinator);
  return coordinator;
}

export function resetMetadataSaveCoordinatorsForTests() {
  for (const coordinator of coordinators.values()) coordinator.dispose();
  coordinators.clear();
}
