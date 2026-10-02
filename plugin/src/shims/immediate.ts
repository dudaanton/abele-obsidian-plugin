/** Lie's FIFO microtask queue, without legacy DOM-based scheduling. */
let queue: Array<() => void> = []
let draining = false

function scheduleDrain(): void {
  if (typeof window.queueMicrotask === 'function') window.queueMicrotask(drain)
  else window.setTimeout(drain, 0)
}

function drain(): void {
  draining = true
  try {
    while (queue.length) {
      const batch = queue
      queue = []
      for (let i = 0; i < batch.length; i++) {
        try {
          batch[i]()
        } catch (error) {
          // Keep callbacks already waiting ahead of any queued by the failed callback.
          queue = batch.slice(i + 1).concat(queue)
          throw error
        }
      }
    }
  } finally {
    draining = false
    if (queue.length) scheduleDrain()
  }
}

export default function immediate(task: () => void): void {
  if (queue.push(task) === 1 && !draining) scheduleDrain()
}
