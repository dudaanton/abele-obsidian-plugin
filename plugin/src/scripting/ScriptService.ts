import { t } from '@/i18n'
import { promptDialog } from '@/components/obsidian/dialogs'
import { TFile, TAbstractFile, debounce, Notice, EventRef, normalizePath } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { scriptSlug } from './scriptSlug'
import { AbeleConfig } from '@/services/AbeleConfig'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { parseScriptHeader, extractScriptBody } from './ScriptParser'
import './ScriptContext'
import './view/components'
import './formModal'
import './abort'
import { type RunSource } from './ScriptRuns'
import { ScriptToolbar } from './toolbarButtons'
import type { ParsedScript, FormField } from './types'
import { isScriptPath, isInScriptsFolder } from './scriptPath'
import { ScriptTrust, ScriptWaitingError, sha256, noteLocalScriptWrite } from './ScriptTrust'
import type { TrustedFile, TrustVerdict } from './trustState'
import { WaitingScriptsNotice, reviewOne, reviewWaiting } from './scriptReview'

import './selectionContext'
import { type SelectionLaunchTarget, type SelectionLaunchOutcome } from './runFromSelection'

import { ref } from 'vue'
import { scriptForExecution } from './trust/scriptExecutionGate'
import { showScriptApproval } from './trust/scriptApprovalPrompt'
import { agentScriptWaiting, confirmAgentScript } from './trust/agentScriptWrites'

/**
 * Who asks for a run with a person right there, having just chosen the script: a script from
 * elsewhere is put in front of them to confirm. Everything else — automations, startup, agents,
 * a script's own `runScript`, a view rebuilt with the layout, a lint rule — is refused.
 */
const ASKS_A_PERSON = new Set<RunSource | 'lint'>([
  'command',
  'note',
  'link',
  'book',
  'chat-selection',
  'request',
])

/** The id of the command that walks through the scripts waiting to be confirmed. */
const REVIEW_COMMAND = 'review-waiting-scripts'

export type { ExecuteOptions, ScriptOutcome } from './scriptExecutionTypes'
import type { ExecuteOptions, ScriptOutcome } from './scriptExecutionTypes'
import { ScriptExecutor } from './ScriptExecutor'

export class ScriptService {
  private static instance: ScriptService | null = null

  private scripts = new Map<string, ParsedScript>()

  private readonly execution = new ScriptExecutor(this)
  private commandIds = new Set<string>()
  private watcherCallbackId: symbol | null = null
  private createEventRef: EventRef | null = null

  /** The scripts on the toolbar, drawn into the notes and the phone's toolbar; see `toolbarButtons.ts`. */
  toolbar: ScriptToolbar | null = null

  /** The index as a reactive list, for anything on screen that shows it. */
  public readonly scriptList = ref<ParsedScript[]>([])

  /**
   * Settles once the first `discover()` of this instance has finished, and so once a script
   * can be found by name. Obsidian rebuilds the layout — and with it every saved script tab —
   * before `onLayoutReady`, which is before `init()` has been called at all; a lookup made
   * then would read an empty index and report the script missing. Anything that needs the
   * index at startup waits here instead.
   */
  ready: Promise<void>
  private markReady: () => void = () => {}
  /** Whether the index has been read at least once; an unread index arms nothing. */
  private indexed = false
  /** Says that scripts from elsewhere wait, while they do. */
  private readonly waitingNotice = new WaitingScriptsNotice(this)

  private constructor() {
    this.ready = this.resetReady()
  }

  private resetReady(): Promise<void> {
    return new Promise((resolve) => {
      this.markReady = resolve
    })
  }

  static getInstance(): ScriptService {
    if (!this.instance) {
      this.instance = new ScriptService()
    }
    const service = this.instance
    // Restored readers/slides can request the index before OR after layout, even with
    // background indexing off. A single deferred scan starts no watchers or toolbar.
    const app = GlobalStore.getInstance().app
    if (app?.workspace.layoutReady) service.discoverStandalone()
    else if (app?.workspace.layoutReady === false && !service.standaloneLayoutQueued) {
      service.standaloneLayoutQueued = true
      app.workspace.onLayoutReady(() => {
        service.standaloneLayoutQueued = false
        if (this.instance === service && GlobalStore.getInstance().app === app)
          service.discoverStandalone()
      })
    }
    return service
  }

  static destroy() {
    if (this.instance) {
      this.instance.cleanup()
      this.instance = null
    }
  }

  private initialized = false
  private disposed = false
  private standaloneLayoutQueued = false

  private discoverStandalone(): void {
    if (this.initialized || this.indexed || this.discovering || this.disposed) return
    void this.discover()
      .catch((error) =>
        console.error('[ScriptService] Could not read the standalone script index:', error)
      )
      .finally(() => this.markReady())
  }

  init() {
    if (this.initialized || this.disposed) return
    this.initialized = true
    // Settled either way: a saved tab waiting on the index must get an answer even when the
    // first discovery threw.
    void this.discover().finally(() => this.markReady())
    this.startWatching()
    this.toolbar?.stop()
    this.toolbar = new ScriptToolbar(this)
    this.toolbar.start()
    this.registerReviewCommand()
  }

  private registerReviewCommand() {
    const plugin = AbeleConfig.getInstance().plugin
    if (!plugin) return
    try {
      plugin.addCommand({
        id: REVIEW_COMMAND,
        name: t('commands.review-scripts'),
        icon: 'shield-check',
        checkCallback: (checking: boolean) => {
          if (!this.waitingScripts().length) return false
          if (!checking) void this.reviewWaiting()
          return true
        },
      })
    } catch (err) {
      console.error('[ScriptService] Error registering the review command:', err)
    }
  }

  async createScript(): Promise<void> {
    const config = AbeleConfig.getInstance()
    const folder = config.ai.scriptsFolder
    if (!folder) {
      new Notice(t('streamC.ae25e33a7e3fec9a'))
      return
    }

    const { app } = GlobalStore.getInstance()
    const name = await promptDialog({ title: t('streamC.4cf2acafe5cc5191') })

    if (!name) return

    const filename = name.endsWith('.js') ? name : `${name}.js`
    const path = normalizePath(`${folder}/${filename}`)

    if (!app.vault.getAbstractFileByPath(folder)) {
      await app.vault.createFolder(folder)
    }

    if (app.vault.getAbstractFileByPath(path)) {
      new Notice(t('streamC.2e9b8309ccb5c57a', { v1: String(path) }))
      return
    }

    const scriptName = filename.replace(/\.js$/, '')
    const template = `// @name ${scriptName}\n// @description \n// @icon scroll-text\n\n`
    await noteLocalScriptWrite(path, template)
    const file = await app.vault.create(path, template)

    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(file)
  }

  /** A script made from a request's picker, indexed before the request names it. */
  async createRequestScript(rawName: string): Promise<string> {
    const name = rawName.trim()
    if (
      !name ||
      /[\\/:*?"<>|]/.test(name) ||
      [...name].some((c) => c.charCodeAt(0) < 32) ||
      name === '.' ||
      name === '..'
    )
      throw new Error('Choose a script name without path separators or control characters')
    if (this.getAll().some((s) => s.meta.name.toLowerCase() === name.toLowerCase()))
      throw new Error(`There is already a script named ${name}`)
    const folder = AbeleConfig.getInstance().ai.scriptsFolder
    if (!folder) throw new Error('Scripts folder is not configured')
    const { app } = GlobalStore.getInstance()
    const path = normalizePath(`${folder}/${name.endsWith('.js') ? name : `${name}.js`}`)
    if (app.vault.getAbstractFileByPath(path)) throw new Error(`File already exists: ${path}`)
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder)
    const source = `// @name ${name}\n// @description \n// @request\n\n`
    await noteLocalScriptWrite(path, source)
    const file = await app.vault.create(path, source)
    await this.discover()
    await app.workspace.getLeaf('tab').openFile(file)
    return name
  }

  private cleanup() {
    this.disposed = true
    this.waitingNotice.hide()
    this.discoverAgain = false
    this.markReady()
    this.toolbar?.stop()
    this.toolbar = null
    if (this.watcherCallbackId) {
      VaultWatcherWrapper.getInstance().removeCallback(this.watcherCallbackId)
      this.watcherCallbackId = null
    }
    if (this.createEventRef) {
      GlobalStore.getInstance().app.vault.offref(this.createEventRef)
      this.createEventRef = null
    }
    this.unregisterAllCommands()
    try {
      ;(AbeleConfig.getInstance().plugin as any)?.removeCommand?.(REVIEW_COMMAND)
    } catch {
      // already gone
    }
    this.scripts.clear()
    this.scriptList.value = []
    this.indexed = false
    this.ready = this.resetReady()
  }

  private startWatching() {
    const config = AbeleConfig.getInstance()
    const folder = config.ai.scriptsFolder
    if (!folder) return

    const debouncedDiscover = debounce(() => this.discover(), 1000)

    this.watcherCallbackId = VaultWatcherWrapper.getInstance().registerCallback((event) => {
      if (
        event.oldPath &&
        (event.type === 'delete' ||
          (event.type === 'rename' && !isInScriptsFolder(event.newPath ?? '')))
      ) {
        this.removeScriptModes(event.oldPath)
      }
      // Both ends of a move: a script moved out of the folder has to leave the index too.
      if (
        [event.newPath, event.oldPath].some(
          (p) => !!p && (isScriptPath(p) || (event.type !== 'modify' && isInScriptsFolder(p)))
        )
      ) {
        debouncedDiscover()
      }
    })

    const { app } = GlobalStore.getInstance()
    this.createEventRef = app.vault.on('create', (file: TAbstractFile) => {
      if (file instanceof TFile && isScriptPath(file.path)) {
        debouncedDiscover()
      }
    })
  }

  /** The rebuild in flight, and whether another was asked for while it ran. */
  private discovering: Promise<void> | null = null
  private discoverAgain = false

  /**
   * Reads the folder again and puts the new index in place of the old one.
   *
   * One rebuild at a time, and the old index stays until the new one is whole. It used to be
   * emptied first and filled back file by file, so every save of a script opened a moment in
   * which the agent's tools, the command palette and every picker saw no scripts at all — and
   * two rebuilds set off together, by the watcher and by a `create` event for the same file,
   * each cleared what the other had gathered and then pruned the tool modes against a
   * half-built index. A rebuild asked for during a rebuild runs once more after it, which
   * covers whatever changed in between.
   */
  discover(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.discovering) {
      this.discoverAgain = true
      return this.discovering
    }
    this.discovering = this.rebuild().finally(() => {
      // Whoever asked for the index first — `init`, or a test — it has been read now.
      this.markReady()
      this.discovering = null
      if (this.discoverAgain && !this.disposed) {
        this.discoverAgain = false
        void this.discover()
      }
    })
    return this.discovering
  }

  private async rebuild(): Promise<void> {
    const config = AbeleConfig.getInstance()
    const folder = config.ai.scriptsFolder
    if (!folder) return

    const { app } = GlobalStore.getInstance()
    const plugin = config.plugin

    // Every .js file under the folder — under it, not beside it: `Scripts-old/` is not `Scripts/`.
    const files = app.vault.getFiles().filter((f) => isScriptPath(f.path))

    const next = new Map<string, ParsedScript>()
    for (const file of files) {
      try {
        const source = await app.vault.read(file)
        const meta = parseScriptHeader(source)
        if (!meta) {
          console.debug(`[ScriptService] Skipping ${file.path}: no @name header`)
          continue
        }

        const code = extractScriptBody(source)
        const commandId = `abele:script-${scriptSlug(meta.name)}`
        // Without a hash the script still lists and, unchecked, runs; checked, it waits.
        const hash = await sha256(source).catch((err: unknown): undefined => {
          console.error(`[ScriptService] Could not hash ${file.path}:`, err)
          return undefined
        })
        next.set(file.path, { path: file.path, meta, code, commandId, source, hash })
      } catch (err) {
        console.error(`[ScriptService] Error parsing ${file.path}:`, err)
      }
    }

    // A disabled service's outstanding reads must never recreate its commands.
    if (this.disposed) return
    // Everything read: the swap itself is synchronous, so nothing observes the gap.
    this.unregisterAllCommands()
    this.scripts = next
    for (const parsed of next.values()) {
      // A lint rule is not something to run: it gives the linter its `check` and `fix`. An
      // interceptor needs a message to decide about, which only a chat sending one has.
      if (parsed.meta.lint || parsed.meta.interceptor) continue
      try {
        plugin.addCommand({
          id: parsed.commandId,
          name: t('commands.script', { name: parsed.meta.name }),
          icon: parsed.meta.icon || 'scroll-text',
          callback: () => this.executeFromCommand(parsed.path),
        })
        this.commandIds.add(parsed.commandId)
        console.debug(`[ScriptService] Registered: ${parsed.meta.name} (${parsed.path})`)
      } catch (err) {
        console.error(`[ScriptService] Error registering ${parsed.path}:`, err)
      }
    }

    this.scriptList.value = Array.from(this.scripts.values())
    this.indexed = true
    ScriptTrust.getInstance().sync(this.trustedFiles())
    this.waitingNotice.announce()
  }

  // ── Scripts from elsewhere ──

  /** The index as the trust record sees it. */
  trustedFiles(): TrustedFile[] {
    return this.getAll()
      .filter((s) => s.hash)
      .map((s) => ({ path: s.path, hash: s.hash!, text: s.source ?? '' }))
  }

  /** Whether this version of the script may run on this device; see `ScriptTrust.ts`. */
  verdict(script: ParsedScript): TrustVerdict {
    if (agentScriptWaiting(GlobalStore.getInstance().app, script.path, script.hash))
      return 'waiting'
    const trust = ScriptTrust.getInstance()
    // Armed by the settings only against an index that has been read: armed against an empty
    // one, every script would wait.
    if (this.indexed) trust.ensureArmed(this.trustedFiles())
    return trust.verdict(script.path, script.hash)
  }

  /** The scripts that wait to be confirmed on this device, refused ones among them. */
  waitingScripts(): ParsedScript[] {
    return this.getAll().filter((s) => this.verdict(s) !== 'confirmed')
  }

  /** The switch in this device's settings: on takes every script as it is now. */
  setConfirmForeign(on: boolean): void {
    const trust = ScriptTrust.getInstance()
    // Before the folder has been read there is nothing to take as it is: let the first read arm it.
    if (on && this.indexed) trust.arm(this.trustedFiles())
    else if (on) trust.allowArming()
    else trust.disarm()
    this.waitingNotice.forget()
    this.waitingNotice.settle()
  }

  /** Vouches for exactly this version — the one shown, the one that runs. */
  confirm(script: ParsedScript): void {
    if (!script.hash) return
    confirmAgentScript(GlobalStore.getInstance().app, script.hash)
    ScriptTrust.getInstance().confirm({
      path: script.path,
      hash: script.hash,
      text: script.source ?? '',
    })
    this.waitingNotice.settle()
  }

  /** Shows a script from elsewhere for review; true once this version is confirmed. */
  async review(script: ParsedScript, signal?: AbortSignal): Promise<boolean> {
    if (!(await reviewOne(this, script, signal))) return false
    // Review also covers the managed gate, without executing a linter/interceptor/startup
    // script as a side effect. This is the recovery exit for an older connection or store.
    await scriptForExecution(GlobalStore.getInstance().app, script.path, (request) =>
      showScriptApproval({ ...request, reviewOnly: true }, signal)
    )
    return true
  }

  /** Every waiting script in turn, from the command and the notice. */
  reviewWaiting(): Promise<void> {
    return reviewWaiting(this)
  }

  /** The script in the index at `path` now, whatever version it is. */
  get(path: string): ParsedScript | undefined {
    return this.scripts.get(path)
  }

  /**
   * The script at `path` as it may run now, or why not.
   *
   * A confirmed version passes. One from elsewhere is put in front of the person when they have
   * just chosen it (`ASKS_A_PERSON`) and refused otherwise. What passes is the index's entry
   * as it is *after* the dialog: if the file changed while it was open, the new version is
   * checked again rather than the confirmation of the old one standing for it.
   */
  async admit(
    path: string,
    source: RunSource | 'lint',
    signal?: AbortSignal
  ): Promise<ParsedScript> {
    for (;;) {
      signal?.throwIfAborted()
      const script = this.scripts.get(path)
      if (!script) throw new Error(`Script not found: ${path}`)
      const verdict = this.verdict(script)
      if (verdict === 'confirmed') return script
      if (!ASKS_A_PERSON.has(source)) throw new ScriptWaitingError(script.meta.name, verdict)
      const confirmed = await this.review(script, signal)
      signal?.throwIfAborted()
      if (!confirmed) throw new ScriptWaitingError(script.meta.name, verdict)
    }
  }

  /** Discovery may see an incomplete synced folder. Only a known removal drops its mode. */
  private removeScriptModes(path: string) {
    const removed = Array.from(this.scripts.values()).filter(
      (script) => script.path === path || script.path.startsWith(`${path}/`)
    )
    const retained = Array.from(this.scripts.values()).filter((script) => !removed.includes(script))
    const config = AbeleConfig.getInstance()
    let dirty = false
    for (const script of removed) {
      const key = `script_${scriptSlug(script.meta.name)}`
      if (retained.some((other) => `script_${scriptSlug(other.meta.name)}` === key)) continue
      for (const modes of [
        config.ai.toolModes,
        ...(config.ai.agents ?? []).map((a) => a.toolModes),
      ]) {
        if (key in modes) {
          delete modes[key]
          dirty = true
        }
      }
    }
    if (dirty)
      void config
        .saveSettings()
        .catch((err) => console.error('[ScriptService] Could not save removed script modes:', err))
  }

  private unregisterAllCommands() {
    const plugin = AbeleConfig.getInstance().plugin
    if (!plugin) return
    for (const id of this.commandIds) {
      try {
        ;(plugin as any).removeCommand(id)
      } catch {
        // command may already be removed
      }
    }
    this.commandIds.clear()
  }

  getAll(): ParsedScript[] {
    return Array.from(this.scripts.values())
  }

  /**
   * The scripts an agent is offered as tools. One waiting to be confirmed is left out: its
   * header — the name and description an agent reads — came from elsewhere too.
   */
  getEnabledToolScripts(): ParsedScript[] {
    return this.getAll().filter(
      (s) =>
        s.meta.enabled !== false &&
        !s.meta.lint &&
        !s.meta.interceptor &&
        (this.verdict(s) === 'confirmed' ||
          agentScriptWaiting(GlobalStore.getInstance().app, s.path, s.hash))
    )
  }

  /** The scripts that are rules of the linter (`// @lint`). */
  getLintScripts(): ParsedScript[] {
    return this.getAll().filter((s) => s.meta.lint)
  }

  definition(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.execution.definition(path, signal)
  }

  setStatus(text: string) {
    this.execution.setStatus(text)
  }

  clearStatus() {
    this.execution.clearStatus()
  }

  executeForAgent(
    path: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    toolContext?: import('@/ai/toolContext').ToolContext
  ): Promise<ScriptOutcome> {
    return this.execution.executeForAgent(path, params, signal, toolContext)
  }

  answerForm(runId: string, values: Record<string, string> | null): Promise<ScriptOutcome | null> {
    return this.execution.answerForm(runId, values)
  }

  pendingForm(runId: string): FormField[] | null {
    return this.execution.pendingForm(runId)
  }

  execute(
    path: string,
    params: Record<string, unknown>,
    options?: AbortSignal | ExecuteOptions,
    formHandler?: (fields: FormField[]) => Promise<Record<string, string> | null>
  ): Promise<string> {
    return this.execution.execute(path, params, options, formHandler)
  }

  forRequest(
    path: string,
    params: Record<string, unknown>,
    interactive: boolean,
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.execution.forRequest(path, params, interactive, signal)
  }

  intercept(
    path: string,
    input: { message: unknown; chat: unknown },
    signal: AbortSignal
  ): Promise<unknown> {
    return this.execution.intercept(path, input, signal)
  }

  executeFromSelection(
    path: string,
    target: SelectionLaunchTarget,
    signal?: AbortSignal
  ): Promise<SelectionLaunchOutcome> {
    return this.execution.executeFromSelection(path, target, signal)
  }

  executeFromCommand(path: string) {
    return this.execution.executeFromCommand(path)
  }

  showParamForm(
    script: ParsedScript,
    selection?: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown> | null> {
    return this.execution.showParamForm(script, selection, signal)
  }
}
