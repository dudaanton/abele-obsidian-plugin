import {
  TFile,
  TAbstractFile,
  debounce,
  Notice,
  EventRef,
  MarkdownView,
  Modal,
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
import { ScriptRuns, type RunSource } from './ScriptRuns'
import type { ParsedScript, FormField } from './types'
import type { RestoreInfo } from './view/View'
import { ref } from 'vue'

/**
 * How to run a script, beyond which one and with what.
 *
 * `execute` used to take these as trailing arguments and still does — an `AbortSignal` in the
 * third place means the same as it always did — so nothing that called it before has to change.
 */
export interface ExecuteOptions {
  signal?: AbortSignal
  /**
   * Shows the script's form and answers with what was filled in, or `null` if it was dismissed.
   *
   * The run's id travels with it, which is what lets a caller that cannot *show* a form —
   * an agent — park the question against the run and answer it later.
   */
  formHandler?: (fields: FormField[], runId: string) => Promise<Record<string, string> | null>
  /** Who asked for the run, for the list of runs. Assumed to be an agent when unsaid: that is
   * the one caller that cannot be given a better answer from inside. */
  source?: RunSource
  /** A saved tab being rebuilt: the leaf waiting for the view and the state it kept. */
  restore?: RestoreInfo
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

/** The script as a function of its context. Throws what the engine threw, said better. */
function compile(code: string): (ctx: ScriptContext) => Promise<unknown> {
  try {
    return new Function(
      'ctx',
      `"use strict";
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

  init() {
    // Settled either way: a saved tab waiting on the index must get an answer even when the
    // first discovery threw.
    void this.discover().finally(() => this.markReady())
    this.startWatching()
  }

  async createScript(): Promise<void> {
    const config = AbeleConfig.getInstance()
    const folder = config.ai.scriptsFolder
    if (!folder) {
      new Notice('Scripts folder is not configured')
      return
    }

    const { app } = GlobalStore.getInstance()
    const name = await new Promise<string | null>((resolve) => {
      const modal = new (class extends Modal {
        onOpen() {
          const { contentEl } = this
          contentEl.createEl('h3', { text: 'New script' })
          const input = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'filename',
            cls: 'abele-name-input',
          })
          input.focus()
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value.trim()) {
              resolve(input.value.trim())
              this.close()
            }
          })
          this.modalEl.addEventListener('click', (e) => {
            if (e.target === this.modalEl) {
              resolve(null)
              this.close()
            }
          })
        }
        onClose() {
          resolve(null)
        }
      })(app)
      modal.open()
    })

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
    const file = await app.vault.create(path, template)

    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(file)
  }

  private cleanup() {
    if (this.watcherCallbackId) {
      VaultWatcherWrapper.getInstance().removeCallback(this.watcherCallbackId)
      this.watcherCallbackId = null
    }
    if (this.createEventRef) {
      GlobalStore.getInstance().app.vault.offref(this.createEventRef)
      this.createEventRef = null
    }
    this.unregisterAllCommands()
    this.scripts.clear()
    this.scriptList.value = []
    this.ready = this.resetReady()
  }

  private startWatching() {
    const config = AbeleConfig.getInstance()
    const folder = config.ai.scriptsFolder
    if (!folder) return

    const debouncedDiscover = debounce(() => this.discover(), 1000)

    this.watcherCallbackId = VaultWatcherWrapper.getInstance().registerCallback((event) => {
      const path = event.newPath || event.oldPath || ''
      if (path.startsWith(folder) && path.endsWith('.js')) {
        debouncedDiscover()
      }
    })

    const { app } = GlobalStore.getInstance()
    this.createEventRef = app.vault.on('create', (file: TAbstractFile) => {
      if (file instanceof TFile && file.path.startsWith(folder) && file.extension === 'js') {
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
    if (this.discovering) {
      this.discoverAgain = true
      return this.discovering
    }
    this.discovering = this.rebuild().finally(() => {
      this.discovering = null
      if (this.discoverAgain) {
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

    // Find all .js files in the folder
    const files = app.vault
      .getFiles()
      .filter((f) => f.path.startsWith(folder) && f.extension === 'js')

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
        next.set(file.path, { path: file.path, meta, code, commandId })
      } catch (err) {
        console.error(`[ScriptService] Error parsing ${file.path}:`, err)
      }
    }

    // Everything read: the swap itself is synchronous, so nothing observes the gap.
    this.unregisterAllCommands()
    this.scripts = next
    for (const parsed of next.values()) {
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
    this.cleanupStaleEntries()
  }

  /** Remove stale script entries from toolModes */
  private cleanupStaleEntries() {
    const validToolNames = new Set(
      Array.from(this.scripts.values()).map((s) => `script_${scriptSlug(s.meta.name)}`)
    )

    const config = AbeleConfig.getInstance()
    let dirty = false

    const modes = config.ai.toolModes
    for (const key of Object.keys(modes)) {
      if (key.startsWith('script_') && key !== 'script_api_docs' && !validToolNames.has(key)) {
        delete modes[key]
        dirty = true
      }
    }

    if (dirty) {
      config.saveSettings()
    }
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

  getEnabledToolScripts(): ParsedScript[] {
    return this.getAll().filter((s) => s.meta.enabled !== false)
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
    const opts: ExecuteOptions =
      options instanceof AbortSignal ? { signal: options, formHandler } : (options ?? {})
    const signal = opts.signal
    const script = this.scripts.get(path)
    if (!script) throw new Error(`Script not found: ${path}`)

    const combinedController = new AbortController()

    const onAbort = () => combinedController.abort()
    signal?.addEventListener('abort', onAbort)

    const runs = ScriptRuns.getInstance()
    const runId = runs.start({
      path,
      name: script.meta.name,
      params,
      source: opts.source ?? 'agent',
      stop: () => combinedController.abort(),
    })
    this.renderStatusBar()

    const logs: string[] = []

    try {
      const handler = opts.formHandler ?? formHandler
      const ctx = buildScriptContext({
        params,
        signal: combinedController.signal,
        logs,
        // The run's id travels with the question: an agent cannot show a form, so it parks
        // it against the run and answers later — see `executeForAgent`. Left unset when nobody
        // can answer, so the context may still fall back to a dialog once a view is open, and
        // say what is wrong when none is.
        formHandler: handler ? (fields) => handler(fields, runId) : undefined,
        onLog: (text) => runs.append(runId, text),
        onStatus: (text) => {
          runs.setNote(runId, text)
          this.renderStatusBar()
        },
        scriptName: script.meta.name,
        restore: opts.restore,
      })

      // Running the user's own script is the feature. The code comes from a `.js` file the
      // user wrote in their own vault, and it is handed only the capabilities in `ctx`; there
      // is no way to execute it without a compiler.
      const fn = compile(script.code)

      const abortPromise = new Promise<never>((_, reject) => {
        combinedController.signal.addEventListener('abort', () =>
          reject(new Error('Script stopped'))
        )
      })

      const result = await Promise.race([fn(ctx), abortPromise])
      const output = logs.length ? logs.join('\n') + '\n' : ''
      const resultStr =
        result !== undefined
          ? typeof result === 'object'
            ? JSON.stringify(result, null, 2)
            : String(result)
          : ''
      runs.finish(runId, output + resultStr)
      return output + resultStr
    } catch (err) {
      // A script that was told to stop threw the same way a broken one does; the list should
      // not read the two alike, and only the controller knows which happened.
      if (combinedController.signal.aborted) runs.markStopped(runId)
      else runs.fail(runId, err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      this.renderStatusBar()
      signal?.removeEventListener('abort', onAbort)
    }
  }

  private async executeFromCommand(path: string) {
    const script = this.scripts.get(path)
    if (!script) return

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
      })
      if (result.trim()) {
        new Notice(result.length > 500 ? result.slice(0, 500) + '...' : result, 10000)
      } else {
        new Notice(`Script "${script.meta.name}" completed.`)
      }
    } catch (err) {
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

  private async showParamForm(script: ParsedScript): Promise<Record<string, unknown> | null> {
    const selection = this.getEditorSelection()
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
    const result = await showFormModal(fields)
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
