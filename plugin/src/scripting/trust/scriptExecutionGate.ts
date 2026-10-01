import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { parseScriptHeader, extractScriptBody } from '../ScriptParser'
import { scriptTrustFor, SCRIPT_TRUST_KEY } from './scriptTrustStorage'
import { storageOf } from '@/sync/vaultWrites'
import { assertCurrentScriptConnection, hasScriptConnection } from './scriptConnection'
import {
  sameBinding,
  type ManagedScript,
  type ScriptBinding,
  type ScriptProvenance,
} from './ScriptProvenance'
import type { ParsedScript } from '../types'

export interface ScriptApprovalRequest {
  path: string
  sha: string
  source: string
  identity: ManagedScript
}
export type ScriptConfirmation = (request: ScriptApprovalRequest) => Promise<boolean>
interface CheckedPermission {
  binding: ScriptBinding
  fileId: string
  generation: number
  provenance: ScriptProvenance
}
const permissions = new WeakMap<ParsedScript, CheckedPermission | null>()

/** Synchronous final fence: no awaited read separates policy validation from compilation. */
export function assertScriptContext(app: App, script: ParsedScript): void {
  if (!permissions.has(script)) throw new Error('Script has no checked execution snapshot')
  const permission = permissions.get(script)
  if (permission) permission.provenance.assertRevision(script.path, permission.generation)
  const expected = permission?.binding ?? null
  const current = storageOf(app)?.loadLocalStorage(SCRIPT_TRUST_KEY) as {
    id?: string
    binding?: ScriptBinding
  } | null
  if (expected === null && !current && !hasScriptConnection(storageOf(app))) return
  if (
    expected &&
    current?.binding &&
    current.id === expected.localVault &&
    sameBinding(current.binding, expected)
  ) {
    assertCurrentScriptConnection(storageOf(app), expected)
    return
  }
  throw new Error('Script connection changed during the execution check')
}
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((value, at) => value === b[at])

/** Every caller executes this snapshot's full bytes, never the discovery cache's body. */
export async function scriptForExecution(
  app: App,
  path: string,
  confirm?: ScriptConfirmation
): Promise<ParsedScript> {
  const read = async () => new Uint8Array(await app.vault.adapter.readBinary(path))
  const bytes = await read()
  let trust = await scriptTrustFor(app)
  let permission: CheckedPermission | null = null
  try {
    if (trust) {
      const sha = await sha256(bytes)
      const initialGeneration = trust.provenance.capture(path)
      const identity = await trust.provenance.lookup(path)
      trust.provenance.assertRevision(path, initialGeneration)
      if (!identity?.fileId) throw new Error('Script provenance is unknown; execution blocked')
      if (identity.binding.facet === 'scoped')
        throw new Error('Shared and agent connections refuse script execution')
      const alreadyApproved = await trust.provenance.approved(identity, sha)
      trust.provenance.assertRevision(path, initialGeneration)
      if (!alreadyApproved) {
        if (!confirm) throw new Error('This exact script version needs device-local approval')
        trust.store.close()
        const accepted = await confirm({ path, sha, source: decode(bytes), identity })
        if (!accepted) throw new Error('This exact script version needs device-local approval')
        if (!equal(bytes, await read()))
          throw new Error('Script changed while its approval was open')
        trust = await scriptTrustFor(app)
        if (!trust) throw new Error('Script provenance changed while its approval was open')
        trust.provenance.assertRevision(path, initialGeneration)
        const current = await trust.provenance.lookup(path)
        trust.provenance.assertRevision(path, initialGeneration)
        if (
          !current ||
          current.fileId !== identity.fileId ||
          !sameBinding(current.binding, identity.binding)
        ) {
          throw new Error('Script identity or policy changed while its approval was open')
        }
        await trust.provenance.approve(path, identity, sha)
      }
      if (!equal(bytes, await read())) {
        throw new Error('Script changed during the execution check; run it again')
      }
      // Revalidate identity AFTER the native read as well as before it.
      // Refresh the descriptor after awaited checks: a connection/facet switch cannot inherit
      // the earlier personal decision, even if the on-disk bytes happen to be identical.
      const live = await scriptTrustFor(app)
      try {
        if (!live || !sameBinding(live.provenance.binding, trust.provenance.binding)) {
          throw new Error('Script connection changed during the execution check')
        }
        const generation = live.provenance.capture(path)
        const current = await live.provenance.lookup(path)
        if (
          !current ||
          current.fileId !== identity.fileId ||
          !(await live.provenance.approved(current, sha))
        ) {
          throw new Error('Script provenance changed during the execution check')
        }
        live.provenance.assertRevision(path, generation)
        permission = {
          binding: { ...live.provenance.binding },
          fileId: current.fileId!,
          generation,
          provenance: live.provenance,
        }
      } finally {
        live?.store.close()
      }
    }
    if (!trust && !equal(bytes, await read()))
      throw new Error('Script changed during the execution check; run it again')
    const source = decode(bytes)
    const meta = parseScriptHeader(source)
    if (!meta) throw new Error('Current script has no name header')
    const script = { path, meta, code: extractScriptBody(source), commandId: '' }
    permissions.set(script, permission)
    assertScriptContext(app, script)
    return script
  } finally {
    trust?.store.close()
  }
}
