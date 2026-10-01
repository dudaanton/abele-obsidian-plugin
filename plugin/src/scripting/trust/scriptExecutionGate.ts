import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { parseScriptHeader, extractScriptBody } from '../ScriptParser'
import { scriptTrustFor } from './scriptTrustStorage'
import type { ParsedScript } from '../types'

/** Every caller executes this snapshot's full bytes, never the discovery cache's body. */
export async function scriptForExecution(app: App, path: string): Promise<ParsedScript> {
  const bytes = new Uint8Array(await app.vault.adapter.readBinary(path))
  const trust = await scriptTrustFor(app)
  try {
    if (trust) {
      const sha = await sha256(bytes)
      const source = await trust.provenance.lookup(path)
      if (!source?.fileId) throw new Error('Script provenance is unknown; execution blocked')
      if (source.binding.facet === 'scoped')
        throw new Error('Shared and agent connections refuse script execution')
      if (!(await trust.provenance.approved(source, sha)))
        throw new Error('This exact script version needs device-local approval')
    }
  } finally {
    trust?.store.close()
  }
  const current = new Uint8Array(await app.vault.adapter.readBinary(path))
  if (current.length !== bytes.length || current.some((value, index) => value !== bytes[index])) {
    throw new Error('Script changed during the execution check; run it again')
  }
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const meta = parseScriptHeader(source)
  if (!meta) throw new Error('Current script has no name header')
  return { path, meta, code: extractScriptBody(source), commandId: '' }
}
