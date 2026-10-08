import { askName } from '@/modal/askName'
import {
  TFile,
  TAbstractFile,
  debounce,
  Notice,
  EventRef,
  MarkdownView,
  normalizePath,
} from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { scriptSlug } from './scriptSlug'
import { AbeleConfig } from '@/services/AbeleConfig'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { parseScriptHeader, extractScriptBody } from './ScriptParser'
import { buildScriptContext, type ScriptContext } from './ScriptContext'
import { VIEW_GLOBALS } from './view/components'
import { showFormModal } from './formModal'
import { waitForScript } from './abort'
import { ScriptRuns, type RunSource } from './ScriptRuns'
import { ScriptToolbar } from './toolbarButtons'
import type { ParsedScript, FormField } from './types'
import { isScriptPath, isInScriptsFolder } from './scriptPath'
import { ScriptTrust, ScriptWaitingError, sha256, noteLocalScriptWrite } from './ScriptTrust'
import type { TrustedFile, TrustVerdict } from './trustState'
import { announceWaiting, reviewOne, reviewWaiting } from './scriptReview'
import type { BookScriptContext } from './bookContext'
import { bookSelection, captureSelection, type SelectionScriptContext } from './selectionContext'
import {
  runFromSelection,
  type SelectionLaunchTarget,
  type SelectionLaunchOutcome,
} from './runFromSelection'
import type { RestoreInfo, ViewHost } from './view/View'
import type { AutomationEvent } from '@/automations/types'
import { ref } from 'vue'
import { scriptForExecution, assertScriptContext } from './trust/scriptExecutionGate'
import { showScriptApproval } from './trust/scriptApprovalPrompt'

/**
 * How to run a script, beyond which one and with what.
 *
 * `execute` used to take these as trailing arguments and still does — an `AbortSignal` in the
 * third place means the same as it always did — so nothing that called it before has to change.
 */
export interface ExecuteOptions {
  /** Explicit user gesture only. Agent, automation, nested and restored runs never prompt. */
  allowApprovalPrompt?: boolean
  signal?: AbortSignal
  /**
   * Shows the script's form and answers with what was filled in, or `null` if it was dismissed.
   *
   * The run's id travels with it, which is what lets a caller that cannot *show* a form —
   * an agent — park the question against the run and answer it later.
   */
  formHandler?: (
    fields: FormField[],
    runId: string,
    signal?: AbortSignal
  ) => Promise<Record<string, string> | null>
  /** Who asked for the run, for the list of runs. Assumed to be an agent when unsaid: that is
   * the one caller that cannot be given a better answer from inside. */
  source?: RunSource
  /** A saved tab being rebuilt: the leaf waiting for the view and the state it kept. */
  restore?: RestoreInfo
  /** An embedded view uses the same component kit without opening a workspace leaf. */
  viewHost?: ViewHost
  /** What set the run off, when an automation did — the script's `event`. */
  event?: AutomationEvent
  /** Told each path the script is about to write; see `buildScriptContext`. */
  onWrite?: (path: string) => void
  /** The message an interceptor script decides about, and the chat around it. */
  intercept?: { message: unknown; chat: unknown }
  /** What started the run, in words, for the list of runs: "Task completed · Tasks/Milk.md". */
  trigger?: string
  /** The words in a book the run was asked for from; the script reads it as `book`. */
  book?: BookScriptContext
  /** Immutable source and durable backlink, also retained for reruns. */
  selection?: SelectionScriptContext
}

/**
 * Every name the prelude puts in a script's scope. A script that declares one of these itself
 * (`const view = …`, `function Table() {}`) cannot be compiled, and the engine's message for
 * that names the identifier and nothing else; `compile` turns it into one that says whose
 * name it is.
 */
const SCRIPT_GLOBALS = [
  'dayjs',
  'read',
  'edit',
  'write',
  'create',
  'remove',
  'move',
  'copy',
  'ls',
  'find',
  'replace',
  'open',
  'setCover',
  'noteInfo',
  'agent',
  'agents',
  'form',
  'log',
  'params',
  'signal',
  'fetch',
  'applyTemplate',
  'listTemplates',
  'createFromTemplate',
  'generateImage',
  'downloadImage',
  'downloadFile',
  'notice',
  'show',
  'runScript',
  'setStatus',
  'activeNotePath',
  'unzip',
  'view',
  ...Object.keys(VIEW_GLOBALS),
]

const REDECLARED = /Identifier '(\w+)' has already been declared/

/** A value as the list of runs shows it; one holding a function (an interceptor's `approve`) too. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_k, v: unknown) => (typeof v === 'function' ? '[function]' : v),
      2
    )
  } catch {
    return String(value)
  }
}

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
])

/** The id of the command that walks through the scripts waiting to be confirmed. */
const REVIEW_COMMAND = 'review-waiting-scripts'

/**
 * The script as a function of its context. Throws what the engine threw, said better.
 *
 * `event`, `book`, `selection`, `books`, `analytics`, `vocabulary`, `message` and `chat` are given in the scope around the script
 * rather than beside the reserved names: they arrived after scripts had been written for years,
 * and all are ordinary names for a variable. Declared out there, a script's own `const event`
 * simply shadows it.
 */
function compile(code: string): (ctx: ScriptContext) => Promise<unknown> {
  try {
    return new Function(
      'ctx',
      `"use strict";
      const { event, book, selection, books, analytics, vocabulary, message, chat } = ctx;
      return (async () => {
        const { ${SCRIPT_GLOBALS.join(', ')} } = ctx;
        ${code}
      })()`
    ) as (ctx: ScriptContext) => Promise<unknown>
  } catch (err) {
    const name = err instanceof SyntaxError ? REDECLARED.exec(err.message)?.[1] : undefined
    if (name && SCRIPT_GLOBALS.includes(name)) {
      throw new Error(`"${name}" is a name the script API reserves; rename it in this script`)
    }
    throw err
  }
}

/**
 * What a lint rule may use: reading the vault and nothing that changes it, asks, opens or reaches
 * out. A rule runs whenever something lints — the agent's `lint` among them, without asking and
 * bounded by a chat's scope that a script's own file calls are not — so its only way to change a
 * note is the text its `fix` returns, which the linter writes through `lint_fix` or the tab.
 */
const LINT_READS = new Set([
  'params',
  'signal',
  'dayjs',
  'event',
  'book',
  'log',
  'activeNotePath',
  'read',
  'ls',
  'find',
  'noteInfo',
  'listTemplates',
])

function readOnly(ctx: ScriptContext, name: string): ScriptContext {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(ctx)) {
    out[key] = LINT_READS.has(key)
      ? value
      : typeof value === 'function'
        ? () => {
            throw new Error(
              `${key}() is not available to the lint rule "${name}": a lint rule may only read; it changes a note by the text its fix returns`
            )
          }
        : undefined
  }
  return out as unknown as ScriptContext
}

/** What came of asking an agent's script to run: it finished, or it stopped to ask something. */
export type ScriptOutcome =
  | { kind: 'done'; output: string }
  | { kind: 'form'; runId: string; fields: FormField[] }

/** A question a running script is holding open, and the way to answer it. */
interface PendingForm {
  runId: string
  fields: FormField[]
  answer: (values: Record<string, string> | null) => void
}

/**
 * The questions of one run, handed over one at a time.
 *
 * A script may ask twice — a form, then another form once it knows the answers — and the two
 * ends of this are never in step: the question can be asked before anybody is waiting for it,
 * and waited for before it is asked. Both orders park.
 */
class FormChannel {
  private asked: PendingForm | null = null
  private waiting: ((form: PendingForm) => void) | null = null

  ask(form: PendingForm): void {
    const waiter = this.waiting
    if (waiter) {
      this.waiting = null
      waiter(form)
      return
    }
    this.asked = form
  }

  next(): Promise<PendingForm> {
    const already = this.asked
    if (already) {
      this.asked = null
      return Promise.resolve(already)
    }
    return new Promise((resolve) => {
      this.waiting = resolve
    })
  }
}

export class ScriptService {
  private static instance: ScriptService | null = null

  private scripts = new Map<string, ParsedScript>()

  /**
   * Runs that stopped to ask something and are still holding the question open.
   *
   * Kept until the run answers or fails. A run nobody answers stays here and stays in the list
   * of runs, where it can be stopped like any other — which is the same thing that happens to
   * a form dialog left open on the screen.
   */
  private readonly suspended = new Map<
    string,
    { run: Promise<string>; channel: FormChannel; current: PendingForm | null }
  >()
  private commandIds = new Set<string>()
  private watcherCallbackId: symbol | null = null
  private createEventRef: EventRef | null = null
  private statusBarEl: HTMLElement | null = null

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
  /** Versions of waiting scripts already announced this session, `path\0hash`. */
  private readonly announced = new Set<string>()

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
    return this.instance
  }

  static destroy() {
    if (this.instance) {
      this.instance.cleanup()
      this.instance = null
    }
  }

  private initialized = false
  private disposed = false

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
        name: 'Review scripts waiting for confirmation',
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
      new Notice('Scripts folder is not configured')
      return
    }

    const { app } = GlobalStore.getInstance()
    const name = await askName(app, { title: 'New script' })

    if (!name) return

    const filename = name.endsWith('.js') ? name : `${name}.js`
    const path = normalizePath(`${folder}/${filename}`)

    if (!app.vault.getAbstractFileByPath(folder)) {
      await app.vault.createFolder(folder)
    }

    if (app.vault.getAbstractFileByPath(path)) {
      new Notice(`File already exists: ${path}`)
      return
    }

    const scriptName = filename.replace(/\.js$/, '')
    const template = `// @name ${scriptName}\n// @description \n// @icon scroll-text\n\n`
    await noteLocalScriptWrite(path, template)
    const file = await app.vault.create(path, template)

    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(file)
  }

  private cleanup() {
    this.disposed = true
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
          name: `Script: ${parsed.meta.name}`,
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
    announceWaiting(this, this.announced)
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
    this.announced.clear()
  }

  /** Vouches for exactly this version — the one shown, the one that runs. */
  confirm(script: ParsedScript): void {
    if (!script.hash) return
    ScriptTrust.getInstance().confirm({
      path: script.path,
      hash: script.hash,
      text: script.source ?? '',
    })
  }

  /** Shows a script from elsewhere for review; true once this version is confirmed. */
  async review(script: ParsedScript, signal?: AbortSignal): Promise<boolean> {
    if (!(await reviewOne(this, script, signal))) return false
    // Review also covers the managed gate, without executing a linter/interceptor/startup
    // script as a side effect. This is the recovery exit for an older connection or store.
    await scriptForExecution(GlobalStore.getInstance().app, script.path,
      (request) => showScriptApproval({ ...request, reviewOnly: true }, signal))
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
        this.verdict(s) === 'confirmed'
    )
  }

  /** The scripts that are rules of the linter (`// @lint`). */
  getLintScripts(): ParsedScript[] {
    return this.getAll().filter((s) => s.meta.lint)
  }

  /**
   * What a script gives back when it is run once with no parameters, as it is: a lint rule's
   * `{ check, fix }`. Functions named `check` and `fix` that the script only declares are handed
   * back too, so a rule may be written either way. Not a run — nothing is listed or shown in the
   * status bar — since the linter calls what comes back once per note.
   */
  async definition(path: string, signal?: AbortSignal): Promise<unknown> {
    await this.admit(path, 'lint', signal)
    const script = await scriptForExecution(GlobalStore.getInstance().app, path)
    const logs: string[] = []
    const ctx = readOnly(
      buildScriptContext({
        params: {},
        signal: signal ?? new AbortController().signal,
        logs,
        scriptName: script.meta.name,
      }),
      script.meta.name
    )
    const declared =
      'return { check: typeof check === "function" ? check : undefined, ' +
      'fix: typeof fix === "function" ? fix : undefined }'
    // The user's own script, as `execute` runs it; see there.
    return compile(`${script.code}\n;${declared}`)(ctx)
  }

  setStatus(text: string) {
    if (!this.statusBarEl) {
      const plugin = AbeleConfig.getInstance().plugin
      if (!plugin) return
      this.statusBarEl = plugin.addStatusBarItem()
    }
    this.statusBarEl.setText(text)
  }

  clearStatus() {
    if (this.statusBarEl) {
      this.statusBarEl.remove()
      this.statusBarEl = null
    }
  }

  /**
   * What the status bar says while scripts are going.
   *
   * It used to be one line per `execute` call with a stop button on it, which broke as soon as
   * two scripts ran at once — whichever finished first cleared the other's line. It now counts
   * what is running and opens the list, where each run has its own stop.
   */
  private renderStatusBar() {
    const running = ScriptRuns.getInstance().running()
    if (!running.length) {
      this.clearStatus()
      return
    }

    const plugin = AbeleConfig.getInstance().plugin
    if (!plugin) return
    if (!this.statusBarEl) {
      this.statusBarEl = plugin.addStatusBarItem()
      this.statusBarEl.addClass('mod-clickable')
      this.statusBarEl.addEventListener('click', () => {
        void this.openRuns()
      })
    }
    this.statusBarEl.setAttribute('aria-label', 'Show script runs')

    const only = running.length === 1 ? running[0] : null
    const label = only ? only.name : `${running.length} scripts`
    this.statusBarEl.setText(only?.note ? `▶ ${label} — ${only.note}` : `▶ ${label}`)
  }

  private async openRuns() {
    const { app } = GlobalStore.getInstance()
    const { SCRIPT_RUNS_VIEW_TYPE } = await import('@/views/ScriptRunsView')
    const existing = app.workspace.getLeavesOfType(SCRIPT_RUNS_VIEW_TYPE)[0]
    const leaf = existing ?? app.workspace.getRightLeaf(false)
    if (!existing) await leaf?.setViewState({ type: SCRIPT_RUNS_VIEW_TYPE, active: true })
    if (leaf) void app.workspace.revealLeaf(leaf)
  }

  /**
   * Runs a script for an agent, and hands back either its output or the question it stopped on.
   *
   * A script that asks for parameters used to be unrunnable from a chat: `ctx.form` threw,
   * every call failed, and nothing about the script said so in advance. Now the question comes
   * back to the agent as a form to fill in, the run stays alive holding it open, and
   * `answer_form` sends the answers into that same run — which may then ask again, or finish.
   */
  async executeForAgent(
    path: string,
    params: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<ScriptOutcome> {
    const channel = new FormChannel()

    const run = this.execute(path, params, {
      signal,
      source: 'agent',
      formHandler: (fields, runId) =>
        new Promise((answer) => channel.ask({ runId, fields, answer })),
    })

    return this.settle(run, channel)
  }

  /**
   * Answers the question a run is holding open, and waits for whatever happens next.
   *
   * `null` is a dismissal, which is what `ctx.form` answers a cancelled dialog with — a script
   * that handles being said no to gets the same treatment from an agent as from a person.
   */
  async answerForm(
    runId: string,
    values: Record<string, string> | null
  ): Promise<ScriptOutcome | null> {
    const held = this.suspended.get(runId)
    if (!held?.current) return null

    const { answer } = held.current
    held.current = null
    answer(values)

    return this.settle(held.run, held.channel)
  }

  /** The fields a run is waiting on, for a caller that wants to say what it is waiting for. */
  pendingForm(runId: string): FormField[] | null {
    return this.suspended.get(runId)?.current?.fields ?? null
  }

  /**
   * Whichever comes first: the script finishing, or it stopping to ask something.
   *
   * A run that stopped is kept here with its promise, because that promise is the only handle
   * on what it eventually answers — and it is deliberately given a listener that swallows the
   * failure, so a script that throws while nobody is waiting does not raise an unhandled
   * rejection. The same promise is awaited again, with its error, when the form is answered.
   */
  private async settle(run: Promise<string>, channel: FormChannel): Promise<ScriptOutcome> {
    const outcome = await Promise.race([
      run.then((output) => ({ kind: 'done', output }) as const),
      channel.next().then((form) => ({ kind: 'form', form }) as const),
    ])

    if (outcome.kind === 'done') {
      for (const [id, held] of this.suspended) {
        if (held.run === run) this.suspended.delete(id)
      }
      return outcome
    }

    run.catch(() => {})
    this.suspended.set(outcome.form.runId, { run, channel, current: outcome.form })
    return { kind: 'form', runId: outcome.form.runId, fields: outcome.form.fields }
  }

  async execute(
    path: string,
    params: Record<string, unknown>,
    options?: AbortSignal | ExecuteOptions,
    formHandler?: (fields: FormField[]) => Promise<Record<string, string> | null>
  ): Promise<string> {
    const given: ExecuteOptions =
      options instanceof AbortSignal ? { signal: options } : (options ?? {})
    // Capture before admission can open a dialog. Reruns use this address, never current UI.
    const book = given.book ? Object.freeze({ ...given.book }) : undefined
    const selection = given.selection
      ? captureSelection(given.selection)
      : book
        ? bookSelection(book)
        : undefined
    const opts: ExecuteOptions = {
      ...given,
      book,
      selection,
      formHandler: given.formHandler ?? formHandler,
    }
    opts.signal?.throwIfAborted()
    await this.admit(path, opts.source ?? 'agent', opts.signal)
    const script = await scriptForExecution(
      GlobalStore.getInstance().app,
      path,
      opts.allowApprovalPrompt ? (request) => showScriptApproval(request, opts.signal) : undefined
    )
    if (script.meta.interceptor) {
      throw new Error(
        `Script "${script.meta.name}" is an interceptor: it runs when a chat sends a message, with that message, and not by itself`
      )
    }
    const { value, output } = await this.run(script, params, opts)
    const resultStr =
      value !== undefined ? (typeof value === 'object' ? safeJson(value) : String(value)) : ''
    return output + resultStr
  }

  /**
   * Runs an interceptor script on a message and hands back what it returned, as it returned it.
   *
   * Never puts the script in front of the person to confirm: they are in the middle of sending
   * a message, and a dialog there would be a surprise. One that waits is refused, and the caller
   * says so.
   */
  async intercept(
    path: string,
    input: { message: unknown; chat: unknown },
    signal: AbortSignal
  ): Promise<unknown> {
    await this.admit(path, 'interceptor', signal)
    const script = await scriptForExecution(GlobalStore.getInstance().app, path)
    if (!script.meta.interceptor) {
      throw new Error(`Script "${script.meta.name}" is not an interceptor (no @interceptor line)`)
    }
    // Admission may have taken a moment; a send stopped meanwhile runs nothing.
    if (signal.aborted) throw new Error('Script stopped')
    const { value } = await this.run(
      script,
      {},
      {
        signal,
        source: 'interceptor',
        formHandler: showFormModal,
        intercept: input,
      }
    )
    return value
  }

  /** One run of an admitted script: its value as returned, and what it printed. */
  private async run(
    script: ParsedScript,
    params: Record<string, unknown>,
    opts: ExecuteOptions
  ): Promise<{ value: unknown; output: string }> {
    const path = script.path
    opts.signal?.throwIfAborted()
    const combinedController = new AbortController()
    // Keep the parent's cancellation attached to returned closures (interceptor policies and
    // view handlers) too, without retaining manual listeners after a completed run.
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, combinedController.signal])
      : combinedController.signal
    const pending = new Set<Promise<unknown>>()
    const track = (work: Promise<unknown>) => {
      pending.add(work)
      void work.then(
        () => pending.delete(work),
        () => pending.delete(work)
      )
    }

    const runs = ScriptRuns.getInstance()
    const runId = runs.start({
      path,
      name: script.meta.name,
      params,
      source: opts.source ?? 'agent',
      stop: () => combinedController.abort(),
      trigger: opts.trigger,
      book: opts.book,
      selection: opts.selection,
    })
    this.renderStatusBar()

    const logs: string[] = []

    try {
      const handler = opts.formHandler
      const ctx = buildScriptContext({
        params,
        signal,
        logs,
        onOperation: track,
        // The run's id travels with the question: an agent cannot show a form, so it parks
        // it against the run and answers later — see `executeForAgent`. Left unset when nobody
        // can answer, so the context may still fall back to a dialog once a view is open, and
        // say what is wrong when none is.
        formHandler: handler ? (fields) => handler(fields, runId, signal) : undefined,
        onLog: (text) => runs.append(runId, text),
        onStatus: (text) => {
          runs.setNote(runId, text)
          this.renderStatusBar()
        },
        scriptName: script.meta.name,
        restore: opts.restore,
        viewHost: opts.viewHost,
        event: opts.event,
        book: opts.book,
        selection: opts.selection,
        onWrite: opts.onWrite,
        intercept: opts.intercept,
      })

      // The common gate checked the current full-byte snapshot and its managed provenance.
      // All commands, nested calls, views, agents and automations compile only that snapshot.
      assertScriptContext(GlobalStore.getInstance().app, script)
      const fn = compile(script.code)

      const result = await waitForScript(() => fn(ctx), signal)
      signal.throwIfAborted()
      const output = logs.length ? logs.join('\n') + '\n' : ''
      const resultStr =
        result !== undefined ? (typeof result === 'object' ? safeJson(result) : String(result)) : ''
      runs.finish(runId, output + resultStr)
      return { value: result, output }
    } catch (err) {
      // A script that was told to stop threw the same way a broken one does; the list should
      // not read the two alike, and only the controller knows which happened.
      if (signal.aborted) {
        // Obsidian cannot cancel an issued vault mutation. Keep the row running until all
        // admitted operations settle; the revoked context prevents any further admissions.
        if (pending.size) runs.setNote(runId, 'Stopping…')
        await Promise.allSettled([...pending])
        runs.markStopped(runId)
      } else runs.fail(runId, err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      this.renderStatusBar()
    }
  }

  /** Shared adapter for the reader and the later chat launch UI; no chat entry point yet. */
  executeFromSelection(
    path: string,
    target: SelectionLaunchTarget,
    signal?: AbortSignal
  ): Promise<SelectionLaunchOutcome> {
    return runFromSelection(
      path,
      target,
      {
        admit: (path, source, signal) => this.admit(path, source, signal),
        showParams: (script, text, signal) => this.showParamForm(script, text, signal),
        execute: (path, params, options) =>
          this.execute(path, params, { ...options, formHandler: showFormModal }),
      },
      signal
    )
  }

  /**
   * Runs a script the way the command palette does — asking for its parameters first. The
   * settings library's run button goes through here too, so both behave the same.
   */
  async executeFromCommand(path: string) {
    let script: ParsedScript
    try {
      // Before the form: its fields come from the script's header, which came with it.
      script = await this.admit(path, 'command')
    } catch (err) {
      if (!(err instanceof ScriptWaitingError)) console.debug('[ScriptService] not run', err)
      return
    }

    let params: Record<string, unknown> = {}

    if (script.meta.params.length > 0) {
      const formResult = await this.showParamForm(script)
      if (!formResult) return // user cancelled
      params = formResult
    }

    try {
      const result = await this.execute(path, params, {
        formHandler: showFormModal,
        source: 'command',
        allowApprovalPrompt: true,
      })
      if (result.trim()) {
        new Notice(result.length > 500 ? result.slice(0, 500) + '...' : result, 10000)
      } else {
        new Notice(`Script "${script.meta.name}" completed.`)
      }
    } catch (err) {
      // Left waiting in the dialog just now: nothing more to say.
      if (err instanceof ScriptWaitingError) return
      const msg = err instanceof Error ? err.message : String(err)
      new Notice(`Script error: ${msg}`, 10000)
      console.error(`[ScriptService] Error executing ${path}:`, err)
    }
  }

  private getEditorSelection(): string {
    const { app } = GlobalStore.getInstance()
    const view = app.workspace.getActiveViewOfType(MarkdownView)
    return view?.editor?.getSelection() || ''
  }

  /**
   * Asks for a script's parameters; one marked `selection` starts out as the words selected —
   * in the note in front, or the ones given (a book's).
   */
  async showParamForm(
    script: ParsedScript,
    selection = this.getEditorSelection(),
    signal?: AbortSignal
  ): Promise<Record<string, unknown> | null> {
    const fields: FormField[] = script.meta.params.map((p) => ({
      name: p.name,
      label: p.description || p.name,
      type:
        p.type === 'boolean'
          ? ('boolean' as const)
          : p.type === 'text'
            ? ('textarea' as const)
            : ('text' as const),
      required: p.required,
      default: p.selection && selection ? selection : p.default,
    }))
    const result = await showFormModal(fields, undefined, signal)
    if (!result) return null

    const typed: Record<string, unknown> = {}
    for (const p of script.meta.params) {
      const v = result[p.name]
      if (p.type === 'boolean') typed[p.name] = v === 'true'
      else if (p.type === 'number') typed[p.name] = Number(v)
      else typed[p.name] = v
    }
    return typed
  }
}
