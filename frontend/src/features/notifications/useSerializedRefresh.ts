import { useCallback, useEffect, useRef } from "react";

export interface SerializedRefresh {
  refreshNow: () => void;
  supersede: () => void;
}

export function useSerializedRefresh(load: (generation: number) => Promise<void>): SerializedRefresh {
  const loadRef = useRef(load);
  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  loadRef.current = load;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queuedRef.current = false;
    };
  }, []);

  const refreshNow = useCallback(() => {
    const run = () => {
      if (!mountedRef.current) return;
      if (inFlightRef.current) {
        queuedRef.current = true;
        return;
      }
      inFlightRef.current = true;
      const generation = generationRef.current;
      void loadRef.current(generation)
        .catch(() => undefined)
        .finally(() => {
          inFlightRef.current = false;
          if (!mountedRef.current) {
            queuedRef.current = false;
            return;
          }
          if (queuedRef.current) {
            queuedRef.current = false;
            run();
          }
        });
    };
    run();
  }, []);

  const supersede = useCallback(() => {
    generationRef.current += 1;
  }, []);

  return { refreshNow, supersede };
}
