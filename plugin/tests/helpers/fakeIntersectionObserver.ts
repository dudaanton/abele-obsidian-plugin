/**
 * A controllable IntersectionObserver for component tests.
 *
 * happy-dom does not compute layout, so nothing ever scrolls and no real observer would
 * ever fire. The paged lists grow when a sentinel element becomes visible, and that is
 * exactly the behaviour under test — so the observer is replaced with one whose callbacks
 * a test can invoke directly.
 *
 * `@vueuse/core` feature-detects `window.IntersectionObserver` and silently becomes a no-op
 * when it is missing, which would make a paging test pass for the wrong reason. Installing
 * this stub is therefore required, not optional, for any test that exercises paging.
 */

interface Registration {
  callback: IntersectionObserverCallback
  observer: IntersectionObserver
  targets: Set<Element>
}

const registrations: Registration[] = []

export function installFakeIntersectionObserver(): void {
  class FakeIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = [0]

    private registration: Registration

    constructor(callback: IntersectionObserverCallback) {
      this.registration = { callback, observer: this, targets: new Set() }
      registrations.push(this.registration)
    }

    observe(target: Element): void {
      this.registration.targets.add(target)
    }

    unobserve(target: Element): void {
      this.registration.targets.delete(target)
    }

    disconnect(): void {
      this.registration.targets.clear()
      const index = registrations.indexOf(this.registration)
      if (index !== -1) registrations.splice(index, 1)
    }

    takeRecords(): IntersectionObserverEntry[] {
      return []
    }
  }

  const global = globalThis as {
    IntersectionObserver?: unknown
    window?: { IntersectionObserver?: unknown }
  }

  global.IntersectionObserver = FakeIntersectionObserver
  // @vueuse/core feature-detects on `window`, which happy-dom exposes as a distinct object.
  if (global.window) global.window.IntersectionObserver = FakeIntersectionObserver
}

/** Forgets every observer registered so far. Call between tests. */
export function resetFakeIntersectionObservers(): void {
  registrations.length = 0
}

/**
 * Reports `element` as having scrolled into view, to whichever observers are watching it.
 *
 * @returns how many observer callbacks were invoked — zero means the element was never
 *          observed, which is a failure of the test's premise rather than of the component.
 */
export function scrollIntoView(element: Element): number {
  let fired = 0

  for (const registration of [...registrations]) {
    if (!registration.targets.has(element)) continue

    fired++
    registration.callback(
      [{ isIntersecting: true, target: element } as IntersectionObserverEntry],
      registration.observer
    )
  }

  return fired
}
