/**
 * Whether an observed element is in view now, from one observer callback. A browser hands over
 * every change recorded since its last callback, oldest first: a sentinel observed below the fold
 * and scrolled to a frame later arrives as `[out, in]`. Reading only the first record misses that
 * it came into view, and since it then stays in view no later record asks again.
 */
export const inViewNow = (entries: readonly IntersectionObserverEntry[]): boolean =>
  entries.reduce<IntersectionObserverEntry | undefined>(
    (last, entry) => (!last || entry.time >= last.time ? entry : last),
    undefined
  )?.isIntersecting ?? false
