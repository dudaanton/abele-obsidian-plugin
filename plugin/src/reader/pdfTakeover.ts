/**
 * "Open PDF files in the Abele reader": which view Obsidian opens a `.pdf` in.
 *
 * Obsidian keeps one view per extension and refuses a second claim through the plugin API, so the
 * switch goes through its view registry: our claim replaces theirs while the setting is on, and
 * theirs is put back when it is turned off or the plugin unloads. Where the registry is not what
 * this expects — a future Obsidian — nothing is changed, and "Open in Abele reader" in the file
 * menu still works.
 */
interface ViewRegistry {
  typeByExtension: Record<string, string>
  registerExtensions(extensions: string[], type: string): void
  unregisterExtensions(extensions: string[]): void
}

const registryOf = (app: unknown): ViewRegistry | null => {
  const reg = (app as { viewRegistry?: Partial<ViewRegistry> }).viewRegistry
  return reg?.typeByExtension &&
    typeof reg.registerExtensions === 'function' &&
    typeof reg.unregisterExtensions === 'function'
    ? (reg as ViewRegistry)
    : null
}

let theirs: string | null = null

/** Makes `.pdf` open in `ours` (on) or in whatever had it before (off). Says whether it could. */
export function setPdfTakeover(app: unknown, on: boolean, ours: string): boolean {
  const reg = registryOf(app)
  if (!reg) return false
  const current = reg.typeByExtension.pdf
  if (on && current !== ours) {
    theirs = current ?? 'pdf'
    if (current) reg.unregisterExtensions(['pdf'])
    reg.registerExtensions(['pdf'], ours)
  } else if (!on && current === ours) {
    reg.unregisterExtensions(['pdf'])
    reg.registerExtensions(['pdf'], theirs ?? 'pdf')
    theirs = null
  }
  return true
}
