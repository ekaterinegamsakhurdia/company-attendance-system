import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs an async loader and tracks { data, loading, error }.
 * Stale responses are ignored; reload() re-runs the loader.
 * `deps` decide when it reloads automatically.
 */
export function useLoad(loader, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, loading: enabled, error: '' });
  const loaderRef = useRef(loader);
  const runId = useRef(0);

  useEffect(() => {
    loaderRef.current = loader;
  });

  const run = useCallback(async () => {
    const id = ++runId.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const data = await loaderRef.current();
      if (id === runId.current) setState({ data, loading: false, error: '' });
    } catch (err) {
      if (id === runId.current) setState((s) => ({ ...s, loading: false, error: err.message || String(err) }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    run();
    // A newer run() (deps changed) makes older responses stale via runId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return { ...state, reload: run };
}
