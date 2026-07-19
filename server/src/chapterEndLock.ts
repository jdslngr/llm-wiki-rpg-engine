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
  // For each key, an ordered list of wakeup callbacks. When the list is empty
  // the key tracks the current holder; when non-empty the first entry is the
  // holder and the rest are waiting. The key is removed from the map only when
  // a holder releases and has no successor — never before waking a successor.
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
          // Shift the next waiter (if any). Wake it while retaining the map
          // entry — deleting before the successor runs lets a third request
          // see no queue and enter concurrently. Only clean up when there is
          // no successor.
          const next = q.shift()
          if (next) {
            next() // wake the next holder — map entry stays
          } else {
            this.queues.delete(pid)
          }
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
