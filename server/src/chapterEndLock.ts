// Process-local FIFO lock for chapter-end operations (recap generation, chapter
// advance). Serialises concurrent requests for the same playthrough so two
// rapid-fire /api/recap or /api/next-chapter calls can't race and produce
// duplicate archive entries or inconsistent state.
//
// Cross-key (different playthrough ids) is fully independent — locking on one
// save never blocks another. This is correct for a single Node.js process.
// Horizontal scaling requires a shared lock (e.g. Postgres advisory lock).

/** A release function returned by acquire(). Call exactly once. */
type Release = () => void

/**
 * Per-key FIFO async lock. Callers acquire a key and get back a promise that
 * resolves to a release function. Only one holder per key at a time; subsequent
 * callers queue in order. Release is guaranteed to wake the next waiter.
 */
export class ChapterEndLock {
  // For each key, an ordered list of wakeup callbacks. The first entry in the
  // list is the CURRENT holder; the rest are waiting. When the list is empty
  // the key is removed from the map.
  private queues = new Map<string, (() => void)[]>()

  /** Acquire the lock for `pid`. Resolves to a release function. Always
   *  resolves — the returned Promise never rejects. */
  acquire(pid: string): Promise<Release> {
    return new Promise<Release>((resolve) => {
      const queue = this.queues.get(pid)

      const makeRelease = (): Release => {
        let released = false
        return () => {
          if (released) return // idempotent
          released = true
          const q = this.queues.get(pid)
          if (!q) return
          // The first entry in the queue is the next waiter (if any).
          // Shift-and-call it so the queue shrinks by one.
          const next = q.shift()
          if (q.length === 0) {
            this.queues.delete(pid)
          }
          if (next) next() // wake the next holder
        }
      }

      if (!queue) {
        // No one holds or waits — we're first.
        this.queues.set(pid, [])
        resolve(makeRelease())
      } else {
        // Queue our wakeup callback.
        queue.push(() => resolve(makeRelease()))
      }
    })
  }

  /** Convenience: run `fn` under the lock, releasing afterwards even if fn throws. */
  async run<T>(pid: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(pid)
    try {
      return await fn()
    } finally {
      release()
    }
  }
}
