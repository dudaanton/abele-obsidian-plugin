import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync, rmdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { VaultCli } from './obsidianCli'
import { captureNativeClipboard, restoreNativeClipboard } from './nativeClipboard'
/** Clipboard is app-wide: take its seconds-long app gate, block new pool leases and wait for
 * every OTHER vault to leave. The owned target lease stays; only its focused editor is driven.
 */
export async function pasteNativeImage(
  cli: VaultCli,
  vaultName: string,
  png: number[]
): Promise<{ trusted: boolean }> {
  const base = join(homedir(), '.local/state/abele'),
    lock = join(base, 'live.lock'),
    pools = join(base, 'vaults')
  if (existsSync(lock)) throw new Error('Shared app clipboard gate busy')
  mkdirSync(lock)
  writeFileSync(
    join(lock, 'owner'),
    'app clipboard-agent-gate ' + process.pid + ' ' + new Date().toISOString()
  )
  let archive: string | null = null
  try {
    const deadline = Date.now() + 30000
    while (
      readdirSync(pools).some((name) => name.endsWith('.lock') && name !== vaultName + '.lock')
    ) {
      if (Date.now() > deadline)
        throw new Error('Other pool leases did not drain for clipboard operation')
      await new Promise((r) => setTimeout(r, 250))
    }
    archive = captureNativeClipboard()
    cli.evalAwait(
      `(()=>{const {clipboard,nativeImage}=require('electron');window.__agentClipboard={trusted:false};const view=app.workspace.getMostRecentLeaf().view;if(!view.editor)throw new Error('Native paste requires markdown editor');const ref=app.workspace.on('editor-paste',event=>{window.__agentClipboard.trusted=event.isTrusted});window.__agentClipboard.ref=ref;const image=nativeImage.createFromBuffer(Buffer.from(${JSON.stringify(png)}));if(image.isEmpty())throw new Error('Native image fixture did not decode');clipboard.writeImage(image);view.contentEl.querySelector('.cm-content').focus();require('@electron/remote').getCurrentWebContents().paste();return true})()`
    )
    const deadlinePaste = Date.now() + 10000
    while (!cli.evalAwait<boolean>('!!window.__agentClipboard.trusted')) {
      if (Date.now() > deadlinePaste) throw new Error('No trusted native image paste event')
      await new Promise((r) => setTimeout(r, 100))
    }
    return { trusted: true }
  } finally {
    try {
      cli.evalAwait(
        `(()=>{const saved=window.__agentClipboard;if(!saved)return true;app.workspace.offref(saved.ref);delete window.__agentClipboard;return true})()`
      )
    } finally {
      try {
        if (archive !== null) restoreNativeClipboard(archive)
      } finally {
        rmSync(join(lock, 'owner'))
        rmdirSync(lock)
      }
    }
  }
}
