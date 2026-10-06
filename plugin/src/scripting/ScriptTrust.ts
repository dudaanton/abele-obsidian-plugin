/**
 * Scripts from elsewhere wait to be confirmed on this device — the keeping of it.
 *
 * With `ai.confirmForeignScripts` on, a script runs from a button, an automation, at startup or
 * for an agent only in a version this device vouches for: one it wrote, one the person confirmed
 * here, or one that was there when checking was switched on. The rules are `trustState.ts`; this
 * keeps that state in Obsidian's local storage — per vault, on this device, never in the vault,
 * since the vault is what syncs — and turns text into the SHA-256 it is recorded by.
 *
 * Checking is armed on this device, not read off the settings each time: the settings file is
 * in the vault too. A setting turned on anywhere arms a device that has not said otherwise, at
 * its next look, taking the scripts as they are then — they were running until that moment
 * anyway. Only the switch in this device's own settings disarms it, and a device switched off
 * that way stays off until it is switched on there again.
 */
import { ref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { isScriptPath } from './scriptPath'
import {
  armedWith,
  armsFromSettings,
  disarmed,
  reconciled,
  sameTrust,
  trustStateFrom,
  verdictOf,
  withArrival,
  withConfirmed,
  type ScriptSourcePolicy,
  type TrustState,
  type TrustVerdict,
  type TrustedFile,
} from './trustState'

/** Where the state is kept, by `App.saveLocalStorage` — per vault, on this device. */
export const TRUST_KEY = 'abele-script-trust'
/** Template approvals use the same records, separately from the optional script switch. */
export const TEMPLATE_TRUST_KEY = 'abele-template-trust'

/** The SHA-256 of a text, in hex. Not a shorter hash: a collision would pass foreign code. */
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** A script held back because this device does not vouch for the version there is now. */
export class ScriptWaitingError extends Error {
  constructor(
    readonly scriptName: string,
    readonly verdict: Exclude<TrustVerdict, 'confirmed'> = 'waiting'
  ) {
    super(
      verdict === 'refused'
        ? `Script "${scriptName}" was not run: the place it arrived from is not allowed to bring scripts to this device`
        : `Script "${scriptName}" was not run: it changed without being written on this device, and waits to be confirmed here`
    )
    this.name = 'ScriptWaitingError'
  }
}

interface LocalStore {
  load(key: string): unknown
  save(key: string, value: unknown): void
}

/** Obsidian's local storage, or a map where there is no app (a test that did not give one). */
function localStore(): LocalStore {
  const app = GlobalStore.getInstance().app as
    | { loadLocalStorage?(key: string): unknown; saveLocalStorage?(key: string, v: unknown): void }
    | undefined
  if (app?.loadLocalStorage && app.saveLocalStorage) {
    return {
      load: (key) => app.loadLocalStorage!(key),
      save: (key, value) => app.saveLocalStorage!(key, value),
    }
  }
  return memory
}

const memoryMap = new Map<string, unknown>()
const memory: LocalStore = {
  load: (key) => memoryMap.get(key),
  save: (key, value) => void (value == null ? memoryMap.delete(key) : memoryMap.set(key, value)),
}

export class ScriptTrust {
  private static instance: ScriptTrust | null = null
  private static templates: ScriptTrust | null = null

  /** Templates always require explicit approval; neither local writes nor a script switch approve them. */
  static forTemplates(): ScriptTrust {
    if (!this.templates) this.templates = new ScriptTrust(TEMPLATE_TRUST_KEY)
    return this.templates
  }

  private constructor(private readonly key = TRUST_KEY) {}

  static getInstance(): ScriptTrust {
    if (!this.instance) this.instance = new ScriptTrust()
    return this.instance
  }

  /** For tests: drop what was read, so the next look reads the store again. */
  static reset(): void {
    this.instance = null
    this.templates = null
    memoryMap.clear()
  }

  /** Moves whenever the state does, for anything on screen that shows a verdict. */
  readonly version = ref(0)

  private state: TrustState | null = null

  private get current(): TrustState {
    if (!this.state) {
      this.state = trustStateFrom(localStore().load(this.key))
      if (this.key === TEMPLATE_TRUST_KEY) {
        this.state.armed = true
        // Preserve older single-version records before any path's latest review is replaced.
        this.state.templateHashes = [
          ...new Set([
            ...(this.state.templateHashes ?? []),
            ...Object.values(this.state.scripts).map((record) => record.hash),
          ]),
        ]
      }
    }
    return this.state
  }

  private put(next: TrustState): void {
    if (sameTrust(next, this.current)) return
    this.state = next
    localStore().save(this.key, next.armed || next.declined ? next : null)
    this.version.value++
  }

  /** Whether the settings ask for checking. */
  private wanted(): boolean {
    return !!AbeleConfig.getInstance().ai?.confirmForeignScripts
  }

  /** Whether this device checks: armed here, whatever the settings file says now. */
  active(): boolean {
    return this.current.armed
  }

  /** Whether it will be armed at the next look at the index: the settings ask, nothing here said no. */
  willArm(): boolean {
    return armsFromSettings(this.current, this.wanted())
  }

  /**
   * Arms this device if the settings ask and it is not yet, taking `files` — the whole index —
   * as vouched for. Only ever called with an index that has been read: armed against an empty
   * one, every script would wait.
   */
  ensureArmed(files: TrustedFile[]): void {
    if (!armsFromSettings(this.current, this.wanted())) return
    this.put(armedWith(this.current, files))
  }

  /** The switch in the settings, turned on here. */
  arm(files: TrustedFile[]): void {
    if (this.current.armed) return
    this.put(armedWith(this.current, files))
  }

  /** Switched on here before there was an index to take: the next look at one arms it. */
  allowArming(): void {
    if (this.current.declined) this.put({ ...this.current, declined: false })
  }

  /** The switch in the settings, turned off here: checking stops, and the record is forgotten. */
  disarm(): void {
    this.put(disarmed())
  }

  /** After the index was read again: arm if asked, then follow renames and drop what is gone. */
  sync(files: TrustedFile[]): void {
    this.ensureArmed(files)
    this.put(reconciled(this.current, files))
  }

  verdict(path: string, hash: string | undefined): TrustVerdict {
    const verdict = verdictOf(this.current, path, hash)
    if (
      verdict === 'waiting' &&
      this.key === TEMPLATE_TRUST_KEY &&
      hash &&
      this.current.templateHashes?.includes(hash)
    )
      return 'confirmed'
    return verdict
  }

  /** The text of the last version confirmed at `path`, for the diff; none when not kept. */
  lastConfirmed(path: string): string | undefined {
    return this.current.scripts[path]?.text
  }

  /** The person looked at this version here and said yes. */
  confirm(file: TrustedFile): void {
    const next = withConfirmed(this.current, file.path, file.hash, file.text)
    if (this.key === TEMPLATE_TRUST_KEY) {
      // Approval belongs to exact content, not whichever version was reviewed last at a path.
      // Copies already share the same hash; confirming another version must not revoke them.
      next.templateHashes = [...new Set([...(this.current.templateHashes ?? []), file.hash])]
    }
    this.put(next)
  }

  /**
   * This device is writing `text` to `path` — the code editor, the plugin, an agent's tool.
   * Anything that is not a script, or written while checking is off, is not recorded.
   */
  async noteLocalWrite(path: string, text: string): Promise<void> {
    if (!this.current.armed || !isScriptPath(path)) return
    const hash = await sha256(text)
    this.put(withConfirmed(this.current, path, hash, text))
  }

  /** A source that knows itself brought `text` to `path`, and says what should happen to it. */
  async noteArrival(path: string, text: string, policy: ScriptSourcePolicy): Promise<void> {
    if (!this.current.armed || !isScriptPath(path)) return
    const hash = await sha256(text)
    this.put(withArrival(this.current, path, hash, text, policy))
  }
}

/** Shorthand for the write sites: record a write made on this device, never throw over it. */
export function noteLocalScriptWrite(path: string, text: string): Promise<void> {
  return ScriptTrust.getInstance()
    .noteLocalWrite(path, text)
    .catch((err) => console.error('[ScriptTrust] could not record a local write', err))
}
