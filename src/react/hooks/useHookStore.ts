import { useEffect, useState, useSyncExternalStore } from "react";
import type { HookStore } from "./HookStore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStore = HookStore<object, any>;
type OptionsOf<S> = S extends HookStore<object, infer O> ? O : never;

/** Creates the component's store, keeps its options up to date and ties its resource to the component. */
export function useHookStore<TStore extends AnyStore>(
  create: (options: OptionsOf<TStore>) => TStore,
  options: OptionsOf<TStore>,
): [TStore, ReturnType<TStore["getSnapshot"]>] {
  const [store] = useState(() => create(options));
  useEffect(() => {
    store.setOptions(options);
  });
  useEffect(() => {
    store.mount();
    return () => store.unmount();
  }, [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return [store, snapshot as ReturnType<TStore["getSnapshot"]>];
}
