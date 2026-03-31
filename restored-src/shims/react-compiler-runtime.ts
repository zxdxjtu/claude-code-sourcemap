/**
 * Shim for react/compiler-runtime
 *
 * The React compiler transforms components to use a cache array (`c` function)
 * for memoization. This shim provides a minimal implementation that allocates
 * a cache array of the requested size, using React's useRef to persist it
 * across renders.
 */

import { useRef } from "react";

const EMPTY_SYMBOL = Symbol.for("react.memo_cache_sentinel");

/**
 * Creates a cache array of the given size for React compiler memoization.
 * Each slot is initialized with a sentinel value that the compiler checks
 * to determine if the cached value needs to be recomputed.
 */
export function c(size: number): Array<unknown> {
  const ref = useRef<Array<unknown> | null>(null);
  if (ref.current === null) {
    const cache = new Array(size);
    for (let i = 0; i < size; i++) {
      cache[i] = EMPTY_SYMBOL;
    }
    ref.current = cache;
  }
  return ref.current;
}
