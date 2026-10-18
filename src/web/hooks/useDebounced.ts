import { useEffect, useRef, useState } from "react";

/** 返回防抖后的值（用于滑块等高频变更，避免频繁重渲染 Composition） */
export function useDebounced<T>(value: T, delay = 120): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDebounced(value), delay);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [value, delay]);
  return debounced;
}
