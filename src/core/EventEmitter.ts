/** Listener of one event. */
export type Listener<T> = (payload: T) => void;

/**
 * Minimal typed event emitter, with no DOM or Node dependency.
 *
 * A listener that throws does not stop the others; the error is passed to
 * `onListenerError` (by default it is rethrown asynchronously so it is not
 * swallowed).
 */
export class EventEmitter<TEvents extends object> {
  private readonly listeners = new Map<keyof TEvents, Set<Listener<never>>>();

  constructor(private readonly onListenerError: (error: unknown) => void = rethrowAsync) {}

  /** Adds a listener and returns a function that removes it. */
  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  /** Adds a listener called at most once. */
  once<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  /** Removes every listener, or only those of `event`. */
  removeAllListeners(event?: keyof TEvents): void {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
  }

  listenerCount(event: keyof TEvents): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<TEvents[K]>)(payload);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
}

function rethrowAsync(error: unknown): void {
  setTimeout(() => {
    throw error;
  }, 0);
}
