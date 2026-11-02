/** Returns a wrapper that runs at most `limit` of the wrapped tasks at once. */
export function limiter(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("concurrency limit must be a positive integer");
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>(resolve => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      next();
    }
  };
}
