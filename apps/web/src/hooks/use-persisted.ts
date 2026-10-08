// One value persisted through the bridge secureStore (the OS keychain in a
// shell, localStorage on the web). The store is asynchronous: the first
// render shows the default, the stored value lands once, and a change made
// before that landing wins over it.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApparatusBridge } from "@/bridge";

export type Codec<T> = {
  parse: (raw: string | null) => T;
  /** null deletes the key: the default is never stored. */
  format: (value: T) => string | null;
};

export function usePersisted<T>(bridge: ApparatusBridge, key: string, codec: Codec<T>): [T, (next: T) => void, boolean] {
  const [value, setValue] = useState<T>(() => codec.parse(null));
  const [loaded, setLoaded] = useState(false);
  const dirty = useRef(false);
  const { parse, format } = codec;

  useEffect(() => {
    let live = true;
    bridge.secureStore
      .get(key)
      .then((raw) => {
        if (!live) return;
        if (!dirty.current) setValue(parse(raw));
        setLoaded(true);
      })
      .catch(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [bridge, key, parse]);

  const set = useCallback(
    (next: T) => {
      dirty.current = true;
      setValue(next);
      const raw = format(next);
      const store = bridge.secureStore;
      void (raw === null ? store.delete(key) : store.set(key, raw)).catch(() => undefined);
    },
    [bridge, key, format],
  );

  return [value, set, loaded];
}
