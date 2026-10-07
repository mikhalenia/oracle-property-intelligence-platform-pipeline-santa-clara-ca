import { useEffect, useState } from "react";

export type AsyncState<T> =
  | { loading: true; data?: undefined; error?: undefined }
  | { loading: false; data: T; error?: undefined }
  | { loading: false; data?: undefined; error: Error };

export function useAsync<T>(fn: () => Promise<T>): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ loading: true });
  useEffect(() => {
    let live = true;
    fn().then(
      (data) => live && setState({ loading: false, data }),
      (e: unknown) =>
        live && setState({ loading: false, error: e instanceof Error ? e : new Error(String(e)) }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
