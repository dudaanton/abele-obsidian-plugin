import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { parseScriptHeader, extractScriptBody } from '../ScriptParser'
import {
  scriptTrustFor,
  SCRIPT_TRUST_KEY,
  ScriptTrustRecoveryRequired,
  recoverScriptProvenance,
} from './scriptTrustStorage'
import { newStateId } from '@/sync/ids'
import { storageOf } from '@/sync/vaultWrites'
import { assertNoScriptContextHold } from './scriptContextHold'
import { legacyScriptPolicy } from './legacyScriptPolicy'
import { TRUST_KEY } from '../ScriptTrust'
import { rememberLocalScriptVersion } from './localScriptUpgrade'
import {
  assertCurrentScriptConnection,
  hasScriptConnection,
  scriptConnectionKey,
  isDisconnectedPersonalScriptContext,
} from './scriptConnection'
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
  recovery?: boolean
  reviewOnly?: boolean
}
export type ScriptConfirmation = (request: ScriptApprovalRequest) => Promise<boolean>
interface CheckedPermission {
  binding: ScriptBinding
  fileId: string | null
  legacyPolicy?: string
  generation: number
  provenance: ScriptProvenance
  connection: string
}
const permissions = new WeakMap<ParsedScript, CheckedPermission | null>()

/** Synchronous final fence: no awaited read separates policy validation from compilation. */
export function assertScriptContext(app: App, script: ParsedScript): void {
  assertNoScriptContextHold(storageOf(app))
  if (!permissions.has(script)) throw new Error('Script has no checked execution snapshot')
  const permission = permissions.get(script)
  if (permission) {
    permission.provenance.assertRevision(script.path, permission.generation)
    if (permission.connection !== scriptConnectionKey(storageOf(app)))
      throw new Error('Script connection changed during the execution check')
    if (
      permission.legacyPolicy !== undefined &&
      permission.legacyPolicy !== (JSON.stringify(app.loadLocalStorage(TRUST_KEY)) ?? 'null')
    )
      throw new Error('Local script approvals changed during the execution check')
  }
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
  try {
    return await checkedScriptForExecution(app, path, confirm)
  } catch (error) {
    const original = error instanceof Error ? error : new Error(String(error ?? ''))
    const failure = original.message.trim()
      ? original
      : new Error(
          `Script execution check failed for "${path}": ${original.name || 'the platform'} supplied no failure reason`,
          { cause: error }
        )
    // WebKit's Error.stack can contain ONLY function@ frames. Preserve the reason for
    // every caller, including diagnostics that print stack instead of message.
    const header = `${failure.name}: ${failure.message}`
    if (!failure.stack?.includes(failure.message))
      failure.stack = `${header}\n${original.stack ?? ''}`
    throw failure
  }
}

async function checkedScriptForExecution(
  app: App,
  path: string,
  confirm?: ScriptConfirmation
): Promise<ParsedScript> {
  const read = async () => new Uint8Array(await app.vault.adapter.readBinary(path))
  const connection = scriptConnectionKey(storageOf(app))
  const bytes = await read()
  let trust: Awaited<ReturnType<typeof scriptTrustFor>>
  let recovered: ManagedScript | null = null
  try {
    trust = await scriptTrustFor(app)
  } catch (error) {
    if (!(error instanceof ScriptTrustRecoveryRequired) || !confirm) throw error
    const sha = await sha256(bytes)
    trust = await recoverScriptProvenance(app, async (binding) => {
      recovered = { binding, fileId: `local:${newStateId()}` }
      const accepted = await confirm({
        path,
        sha,
        source: decode(bytes),
        identity: recovered,
        recovery: true,
      })
      if (!equal(bytes, await read()))
        throw new Error('Script changed while its recovery approval was open')
      return accepted
    })
  }
  let permission: CheckedPermission | null = null
  let versionToRemember: string | null = null
  try {
    const recoveredIdentity = recovered as ManagedScript | null
    if (recoveredIdentity && trust) {
      await trust.provenance.record(path, recoveredIdentity.fileId!)
      await trust.provenance.approve(path, recoveredIdentity, await sha256(bytes))
    }
    if (trust) {
      const sha = await sha256(bytes)
      let initialGeneration = trust.provenance.capture(path)
      let identity = await trust.provenance.lookup(path)
      trust.provenance.assertRevision(path, initialGeneration)
      const legacy = legacyScriptPolicy(app, path, sha)
      const offlineUnmanaged =
        !identity &&
        isDisconnectedPersonalScriptContext(storageOf(app), trust.provenance.binding) &&
        !(await trust.provenance.hasSourceEvidence(path))
      const localFallback = offlineUnmanaged && legacy.verdict === 'confirmed'
      trust.provenance.assertRevision(path, initialGeneration)
      if (offlineUnmanaged && legacy.verdict === 'refused')
        throw new Error("This script was refused by this device's local source policy")
      if (offlineUnmanaged && !localFallback && !confirm)
        throw new Error('This exact local script version needs device-local approval')
      if (!identity && !localFallback && confirm && trust.provenance.binding.facet === 'personal') {
        const proposed = { binding: trust.provenance.binding, fileId: `local:${newStateId()}` }
        const accepted = await confirm({
          path,
          sha,
          source: decode(bytes),
          identity: proposed,
          recovery: true,
        })
        if (!accepted) throw new Error('This exact script version needs device-local approval')
        if (!equal(bytes, await read()))
          throw new Error('Script changed while its approval was open')
        assertNoScriptContextHold(storageOf(app))
        trust.provenance.assertRevision(path, initialGeneration)
        if (
          connection !== scriptConnectionKey(storageOf(app)) ||
          JSON.stringify(
            (
              storageOf(app)?.loadLocalStorage(SCRIPT_TRUST_KEY) as {
                binding?: ScriptBinding
              } | null
            )?.binding
          ) !== JSON.stringify(proposed.binding)
        )
          throw new Error('Script connection changed while its approval was open')
        await trust.provenance.record(path, proposed.fileId)
        await trust.provenance.approve(path, proposed, sha)
        initialGeneration = trust.provenance.capture(path)
        identity = await trust.provenance.lookup(path)
      }
      if (!localFallback && !identity?.fileId)
        throw new Error(
          'Script provenance is unknown; execution blocked. Review this script under Settings → Scripts → Library; pending sync writes must settle first'
        )
      if (trust.provenance.binding.facet === 'scoped')
        throw new Error('Shared and agent connections refuse script execution')
      // The older device-local EXACT approval remains a decision even when a managed
      // descriptor already existed before the newer upgrade snapshot was introduced.
      if (!localFallback && legacy.exact) {
        await trust.provenance.approve(path, identity!, sha)
      }
      const alreadyApproved = localFallback || (await trust.provenance.approved(identity!, sha))
      trust.provenance.assertRevision(path, initialGeneration)
      if (!alreadyApproved) {
        if (!confirm) throw new Error('This exact script version needs device-local approval')
        trust.store.close()
        const accepted = await confirm({ path, sha, source: decode(bytes), identity: identity! })
        if (!accepted) throw new Error('This exact script version needs device-local approval')
        if (!equal(bytes, await read()))
          throw new Error('Script changed while its approval was open')
        if (connection !== scriptConnectionKey(storageOf(app)))
          throw new Error('Script connection changed while its approval was open')
        trust = await scriptTrustFor(app)
        if (!trust) throw new Error('Script provenance changed while its approval was open')
        trust.provenance.assertRevision(path, initialGeneration)
        const current = await trust.provenance.lookup(path)
        trust.provenance.assertRevision(path, initialGeneration)
        if (
          !current ||
          current.fileId !== identity!.fileId ||
          !sameBinding(current.binding, identity!.binding)
        ) {
          throw new Error('Script identity or policy changed while its approval was open')
        }
        await trust.provenance.approve(path, identity!, sha)
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
        // Keep the original observation across every await; a completed mutation is not a
        // new permission baseline merely because it restored the same identity/approval.
        const generation = initialGeneration
        live.provenance.assertRevision(path, generation)
        const current = await live.provenance.lookup(path)
        if (localFallback) {
          if (
            current ||
            (await live.provenance.hasSourceEvidence(path)) ||
            legacy.key !== legacyScriptPolicy(app, path, sha).key
          )
            throw new Error(
              'Script provenance or local approval changed during the execution check'
            )
        } else if (
          !current ||
          current.fileId !== identity!.fileId ||
          !(await live.provenance.approved(current, sha))
        ) {
          throw new Error('Script provenance changed during the execution check')
        }
        live.provenance.assertRevision(path, generation)
        // A verified approval in the temporary local recovery namespace is an explicit
        // local decision, not an old remote binding's permission. Carry only its exact bytes.
        if (localFallback || live.provenance.binding.endpoint === 'local:') versionToRemember = sha
        permission = {
          binding: { ...live.provenance.binding },
          fileId: current?.fileId ?? null,
          ...(localFallback ? { legacyPolicy: legacy.key } : {}),
          generation,
          provenance: live.provenance,
          connection,
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
    if (versionToRemember !== null) {
      // Persist only AFTER the final synchronous context fence, never from an invalidated
      // approval or a scoped transition during the awaited IDB checks.
      rememberLocalScriptVersion(app, path, versionToRemember)
      assertScriptContext(app, script)
    }
    return script
  } finally {
    trust?.store.close()
  }
}
