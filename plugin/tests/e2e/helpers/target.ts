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
