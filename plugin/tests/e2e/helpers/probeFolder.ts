import { randomBytes } from 'node:crypto'
import type { VaultCli } from './obsidianCli'

/** Own only a successful create. A lost reply/failure leaves data alone rather than guessing. */
export async function withProbeFolder<T>(
  cli: Pick<VaultCli, 'evalAwait'>,
  prefix: string,
  run: (root: string) => Promise<T>
): Promise<T> {
  const root = `${prefix}-${randomBytes(16).toString('hex')}`
  let owned = false
  try {
    const created = cli.evalAwait<boolean>(`(async () => {
      await app.vault.createFolder(${JSON.stringify(root)})
      return true
    })()`)
    if (created !== true) throw new Error('Probe folder creation was not acknowledged')
    owned = true
    return await run(root)
  } finally {
    if (owned)
      cli.evalAwait(`(async () => {
      const folder = app.vault.getAbstractFileByPath(${JSON.stringify(root)})
      if (folder) await app.vault.delete(folder, true)
      return true
    })()`)
  }
}
