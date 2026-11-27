/**
 * State container shared by the React hooks.
 *
 * A hook keeps one store per component (`useState(() => new Store())`) and
 * reads it with `useSyncExternalStore`. The store owns the SDK resource
 * (`FacialCheck`, `CameraManager`, engine, `ChallengeManager`): it only
 * forwards calls and mirrors state; every analysis stays in the core.
 *
 * Lifecycle: `mount()` / `unmount()` are called by an effect. Acquiring the
 * resource is deferred by one microtask, so React StrictMode's
 * mount → unmount → mount (run synchronously in development) acquires it once.
 * `unmount()` releases it synchronously, so the camera and the models are
 * freed as soon as the component goes away.
 */
export abstract class HookStore<TSnapshot extends object, TOptions> {
  protected snapshot: TSnapshot;
  protected options: TOptions;

  private readonly listeners = new Set<() => void>();
  private mounted = false;
  private acquired = false;
  private acquireScheduled = false;

  constructor(options: TOptions, initial: TSnapshot) {
    this.options = options;
    this.snapshot = initial;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): TSnapshot => this.snapshot;

  /** Latest hook options (callbacks are read at call time). */
  setOptions(options: TOptions): void {
    const previous = this.options;
    this.options = options;
    if (this.acquired) this.optionsChanged(previous);
  }

  mount(): void {
    this.mounted = true;
    if (this.acquired || this.acquireScheduled) return;
    this.acquireScheduled = true;
    queueMicrotask(() => {
      this.acquireScheduled = false;
      this.ensureAcquired();
    });
  }

  unmount(): void {
    this.mounted = false;
    if (!this.acquired) return;
    this.acquired = false;
    this.release();
  }

  /** Acquires the resource now if the component is mounted. Returns whether it is acquired. */
  protected ensureAcquired(): boolean {
    if (!this.mounted) return false;
    if (!this.acquired) {
      this.acquired = true;
      this.acquire();
    }
    return true;
  }

  protected get isAcquired(): boolean {
    return this.acquired;
  }

  /** Shallow-merges `patch`; listeners are notified only when a field changed. */
  protected setState(patch: Partial<TSnapshot>): void {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof TSnapshot)[]) {
      if (!Object.is(this.snapshot[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  protected abstract acquire(): void;
  protected abstract release(): void;
  /** Called when the options change while the resource is acquired. Default: nothing (options are read on acquire). */
  protected optionsChanged(previous: TOptions): void {
    void previous;
  }
}

/** Copy of `source` without `keys` (hook-only options are not passed to the core). */
export function omit<T extends object>(source: T, keys: readonly PropertyKey[]): Record<string, unknown> {
  const skip = new Set<PropertyKey>(keys);
  return Object.fromEntries(Object.entries(source).filter(([key]) => !skip.has(key)));
}
