import type { ScenarioLease } from "./types";

export interface EditLeaseTransport {
  acquire(storyId: number): Promise<ScenarioLease>;
  heartbeat(storyId: number, lease: ScenarioLease): Promise<{ ok: true; expires_at: string }>;
  release(storyId: number, lease: ScenarioLease, keepalive: boolean): Promise<unknown>;
}

export interface EditLeaseSnapshot {
  lease: ScenarioLease | null;
  error: string;
  resumeVersion: number;
}

interface AcquireOperation {
  epoch: number;
  promise: Promise<ScenarioLease>;
  staleReleaseKeepalive: boolean;
}

interface HeartbeatOperation {
  epoch: number;
  credentialKey: string;
  promise: Promise<void>;
}

export class EditLeaseLifecycleCancelledError extends Error {
  constructor() {
    super("Редактор сценария закрыт");
    this.name = "EditLeaseLifecycleCancelledError";
  }
}

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

const terminalLeaseError = (error: unknown) => {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  return code === "SCENARIO_LEASE_EXPIRED" || code === "SCENARIO_LEASE_INVALID";
};

const credentialKey = (storyId: number, lease: ScenarioLease) =>
  `${storyId}:${lease.edit_session_id}:${lease.lease_token}`;

export class EditLeaseController {
  private epoch = 0;
  private phase: "active" | "suspended" = "active";
  private credential: ScenarioLease | null = null;
  private acquireOperation: AcquireOperation | null = null;
  private heartbeatOperation: HeartbeatOperation | null = null;
  private priorEpochBarrier: Promise<void>;
  private readonly releaseOperations = new Map<string, Promise<void>>();
  private lastActivityAt = 0;
  private snapshot: EditLeaseSnapshot = { lease: null, error: "", resumeVersion: 0 };
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly storyId: number,
    private readonly transport: EditLeaseTransport,
    initialBarrier: Promise<void> = Promise.resolve(),
    private readonly now: () => number = Date.now,
    private readonly inactivityMs = 90_000,
  ) {
    this.priorEpochBarrier = initialBarrier;
  }

  getSnapshot = (): EditLeaseSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(lease: ScenarioLease | null, error = this.snapshot.error, resumeVersion = this.snapshot.resumeVersion) {
    this.snapshot = { lease, error, resumeVersion };
    this.listeners.forEach((listener) => listener());
  }

  private isCurrentCredential(epoch: number, key: string) {
    return this.phase === "active"
      && this.epoch === epoch
      && this.credential !== null
      && credentialKey(this.storyId, this.credential) === key;
  }

  private releaseOnce(lease: ScenarioLease, keepalive: boolean): Promise<void> {
    const key = credentialKey(this.storyId, lease);
    const existing = this.releaseOperations.get(key);
    if (existing) return existing;
    const release = this.transport.release(this.storyId, lease, keepalive).then(() => undefined);
    this.releaseOperations.set(key, release);
    return release;
  }

  private invalidate(nextPhase: "active" | "suspended", keepalive: boolean, error = ""): Promise<void> {
    const previousBarrier = this.priorEpochBarrier;
    const previousAcquire = this.acquireOperation;
    const previousCredential = this.credential;
    this.epoch += 1;
    this.phase = nextPhase;
    this.credential = null;
    if (previousAcquire) previousAcquire.staleReleaseKeepalive = keepalive;
    this.publish(null, error);

    const draining: Promise<unknown>[] = [previousBarrier.catch(() => undefined)];
    if (previousCredential) draining.push(this.releaseOnce(previousCredential, keepalive));
    if (previousAcquire) draining.push(previousAcquire.promise.catch(() => undefined));
    const barrier = Promise.allSettled(draining).then(() => undefined);
    this.priorEpochBarrier = barrier;
    return barrier;
  }

  private invalidateIfInactive(now: number) {
    if (
      this.phase !== "active"
      || !this.credential
      || now - this.lastActivityAt <= this.inactivityMs
    ) return false;
    void this.invalidate("active", false);
    return true;
  }

  acquire = (): Promise<ScenarioLease> => {
    if (this.phase !== "active") return Promise.reject(new EditLeaseLifecycleCancelledError());
    const now = this.now();
    this.invalidateIfInactive(now);
    this.lastActivityAt = now;
    if (this.credential) return Promise.resolve(this.credential);
    if (this.acquireOperation?.epoch === this.epoch) return this.acquireOperation.promise;

    const epoch = this.epoch;
    const barrier = this.priorEpochBarrier;
    const operation = {} as AcquireOperation;
    const promise = barrier
      .then(() => {
        if (this.phase !== "active" || this.epoch !== epoch || this.acquireOperation !== operation) {
          throw new EditLeaseLifecycleCancelledError();
        }
        return this.transport.acquire(this.storyId);
      })
      .then(async (next) => {
        if (this.phase !== "active" || this.epoch !== epoch || this.acquireOperation !== operation) {
          await this.releaseOnce(next, operation.staleReleaseKeepalive).catch(() => {
            // Exact release is best effort after lifecycle cancellation; server TTL is the fallback.
          });
          throw new EditLeaseLifecycleCancelledError();
        }
        this.credential = next;
        this.publish(next, "");
        return next;
      })
      .catch((error) => {
        if (
          !(error instanceof EditLeaseLifecycleCancelledError)
          && this.phase === "active"
          && this.epoch === epoch
          && this.acquireOperation === operation
        ) {
          this.publish(this.credential, errorMessage(error, "Не удалось получить право редактирования"));
        }
        throw error;
      })
      .finally(() => {
        if (this.acquireOperation === operation) this.acquireOperation = null;
      });
    Object.assign(operation, { epoch, promise, staleReleaseKeepalive: true });
    this.acquireOperation = operation;
    return promise;
  };

  release = (): Promise<void> => this.invalidate("active", false);

  suspend = (): Promise<void> => this.invalidate("suspended", true);

  activateForMount = () => {
    if (this.phase === "suspended") this.phase = "active";
  };

  resumeFromPageCache = (persisted: boolean) => {
    if (!persisted || this.phase !== "suspended") return;
    this.phase = "active";
    this.publish(null, "", this.snapshot.resumeVersion + 1);
  };

  touch = () => {
    const now = this.now();
    this.invalidateIfInactive(now);
    this.lastActivityAt = now;
  };

  heartbeatTick = () => {
    if (this.phase !== "active" || !this.credential) return;
    if (this.invalidateIfInactive(this.now())) return;

    const current = this.credential;
    const epoch = this.epoch;
    const key = credentialKey(this.storyId, current);
    if (this.heartbeatOperation?.epoch === epoch && this.heartbeatOperation.credentialKey === key) return;
    const operation = {} as HeartbeatOperation;
    const promise = this.transport.heartbeat(this.storyId, current)
      .then((ack) => {
        if (!this.isCurrentCredential(epoch, key) || this.heartbeatOperation !== operation) return;
        const next = { ...current, expires_at: ack.expires_at };
        this.credential = next;
        this.publish(next, "");
      })
      .catch((error) => {
        if (this.isCurrentCredential(epoch, key) && this.heartbeatOperation === operation) {
          const message = errorMessage(error, "Не удалось продлить право редактирования");
          if (terminalLeaseError(error)) void this.invalidate("active", false, message);
          else this.publish(this.credential, message);
        }
      })
      .finally(() => {
        if (this.heartbeatOperation === operation) this.heartbeatOperation = null;
      });
    Object.assign(operation, { epoch, credentialKey: key, promise });
    this.heartbeatOperation = operation;
  };
}
