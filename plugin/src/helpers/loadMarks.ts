/**
 * Performance marks around the plugin's own start, read by the load-time probe in the e2e tier
 * (`tests/e2e/loadTime.e2e.test.ts`).
 *
 * Always on, in production builds too: a mark costs microseconds and one entry per load, and
 * keeping them in the shipped build is what lets the same probe time the file a user actually
 * gets rather than only the development one.
 *
 * - `evalStart` — the first statement of `main.js` (the build prepends it, see
 *   `EVAL_START_INTRO`). Everything before it is Obsidian reading the file and compiling it.
 * - `evalEnd` — the first statement of `main.ts`'s own body, which runs after every module it
 *   imports has run its top-level code.
 * - `onloadStart` / `onloadEnd` — the plugin's `onload()`, settings read included.
 * - `layoutStart` / `layoutEnd` — the plugin's first and last `onLayoutReady` callbacks, so the
 *   work it puts off until the workspace is there (task, finance and time indexes, snippets,
 *   chat tabs) is measured apart. On a reload the layout is already there and they run inside
 *   `onload`; on an app start they run once Obsidian has restored the workspace, which is
 *   where most of the plugin's start-up cost is paid.
 */
export const LOAD_MARKS = {
  evalStart: 'abele:eval-start',
  evalEnd: 'abele:eval-end',
  onloadStart: 'abele:onload-start',
  onloadEnd: 'abele:onload-end',
  layoutStart: 'abele:layout-start',
  layoutEnd: 'abele:layout-end',
} as const

export type LoadMark = keyof typeof LOAD_MARKS

export function markLoad(name: LoadMark): void {
  if (typeof performance === 'undefined') return
  performance.mark(LOAD_MARKS[name])
}

/**
 * The statement the build puts at the very top of `main.js` (`output.intro`), before any
 * module's code. Plain text, because it runs before anything can be imported — and a literal
 * rather than built from `LOAD_MARKS`, so the bundle carries no dead copy of it.
 */
export const EVAL_START_INTRO =
  'typeof performance!=="undefined"&&performance.mark("abele:eval-start");'
