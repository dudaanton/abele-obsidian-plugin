/**
 * Which device the e2e tier drives: the desktop app through the `obsidian` CLI (the default), or
 * Obsidian on a real phone (`E2E_TARGET=phone`, see `phone.ts` and docs/Testing.md).
 *
 * A test file says where it can run with `targets(...)` at its top. The e2e config reads that
 * call from the source to decide which files a run includes, so a file that never calls it is
 * a desktop file and a phone run does not load it at all. The call itself only checks the list.
 */
export type Target = 'desktop' | 'phone'

export const TARGET: Target = process.env.E2E_TARGET === 'phone' ? 'phone' : 'desktop'

export const onPhone = (): boolean => TARGET === 'phone'

/** Declares the devices a test file runs on. Read by `vitest.e2e.config.ts`; see above. */
export function targets(...list: Target[]): void {
  for (const t of list)
    if (t !== 'desktop' && t !== 'phone') throw new Error(`targets(): unknown target ${String(t)}`)
}

/**
 * Cases a batch between releases leaves out: the heaviest measurements, whose full size only a
 * release has to prove (`ABELE_E2E_INTERIM=1`, set by the batch runner for every batch that does
 * not gate a release). Unset, everything runs, so a runner that does not know the flag costs
 * time, never coverage.
 */
export const interimRun = (): boolean => process.env.ABELE_E2E_INTERIM === '1'

/**
 * Whether a run asked for something by its variable (`ABELE_MEASURE_HISTORY=1`): for files that
 * measure or record rather than check, and for checks of the test harness itself. Wrap the file
 * in `describe.runIf(requested(...))`: a file whose every case is skipped is skipped whole, its
 * setup included, so leaving it out costs nothing.
 */
export const requested = (variable: string): boolean => process.env[variable] === '1'

/**
 * Files whose emulated phone checks something the real-phone run of the same file does not
 * (a desktop-only probe, a width the phone cannot take, a case skipped on the phone): they keep
 * their emulated pass even when the batch runs the real phone too.
 */
const EMULATION_ONLY = new Set([
  'bookLibraryScript',
  'bookOverlayReflow',
  'footerTaskClick',
  'githubNotifications',
  'taskTimelineScroll',
])

/**
 * Whether the phone layout this desktop file is about to emulate is checked anyway by the real
 * phone in the same batch (`ABELE_E2E_REAL_PHONE=1`, set by a batch that runs the phone tier):
 * the file runs on the phone too and repeats there what it emulates here.
 */
export function emulationCovered(
  testPath: string | undefined,
  source: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.ABELE_E2E_REAL_PHONE !== '1' || !testPath) return false
  const name = testPath
    .split('/')
    .pop()!
    .replace(/\.e2e\.test\.ts$/, '')
  return !EMULATION_ONLY.has(name) && declaredTargets(source).includes('phone')
}

/**
 * Thrown where a desktop file would enter the emulated phone that the real phone covers in the
 * same batch (`emulationCovered`). The case, or the part whose setup threw it, is reported
 * skipped, with this as the reason.
 */
export class EmulationCoveredError extends Error {
  constructor() {
    super('skipped: the real phone checks this layout in the same batch')
    this.name = 'EmulationCoveredError'
  }
}

/**
 * Thrown by a helper that exists only on the desktop — the DevTools protocol, Electron's
 * windows, the CLI's console capture — when it is asked for on a phone. The e2e setup turns a
 * test that fails with nothing but this into a skip, naming what it needed, so a phone run
 * reports what it could not check instead of failing on it.
 */
export class DesktopOnlyError extends Error {
  constructor(what: string) {
    super(`desktop only: ${what}`)
    this.name = 'DesktopOnlyError'
  }
}

export function desktopOnly(what: string): never {
  throw new DesktopOnlyError(what)
}

/** The source text marks `targets(...)` reads, for the config: which of `list` a file names. */
export function declaredTargets(source: string): Target[] {
  const m = /\btargets\(([^)]*)\)/.exec(source)
  if (!m) return ['desktop']
  return (['desktop', 'phone'] as const).filter((t) => m[1].includes(`'${t}'`))
}
