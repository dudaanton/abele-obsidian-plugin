/** Answers whether one vault path is itself a symbolic link. */
export type SymlinkProbe = (path: string) => Promise<boolean>

const missing = (error: unknown) => (error as { code?: string } | null)?.code === 'ENOENT'

/**
 * True when the path or any folder above it, from the vault root down, is a symbolic link.
 * A symlinked ancestor takes its whole subtree out of the vault, so checking the last
 * component alone would follow it. A component that does not exist yet is not a link, and
 * nothing below it can be. `seen` shares answers across one inventory pass.
 */
export async function crossesSymlink(
  path: string,
  isSymlink: SymlinkProbe,
  seen: Map<string, Promise<boolean | null>> = new Map()
): Promise<boolean> {
  const parts = path.split('/').filter((part) => part !== '')
  for (let length = 1; length <= parts.length; length++) {
    const prefix = parts.slice(0, length).join('/')
    let answer = seen.get(prefix)
    if (answer === undefined) {
      answer = isSymlink(prefix).catch((error: unknown): null => {
        if (missing(error)) return null
        throw error
      })
      seen.set(prefix, answer)
    }
    const linked = await answer
    if (linked === null) return false
    if (linked) return true
  }
  return false
}
