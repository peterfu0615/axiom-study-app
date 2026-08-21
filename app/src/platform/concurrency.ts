/**
 * Order-preserving bounded-concurrency map.
 *
 * IPC round trips (Tauri invoke) are cheap individually but serial `await`
 * loops multiply latency by the number of items.  Running a bounded number of
 * tasks in parallel keeps media/DB commands from overwhelming the backend
 * while still cutting wall-clock time substantially.
 *
 * Results keep the input order regardless of completion order.  The first
 * rejection rejects the whole call; in-flight tasks continue but their results
 * are discarded.
 */
export async function mapWithConcurrency<TInput, TResult>(
  items: readonly TInput[],
  concurrency: number,
  task: (item: TInput, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length)
  let next = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next
        next += 1
        results[index] = await task(items[index], index)
      }
    },
  )
  await Promise.all(workers)
  return results
}
