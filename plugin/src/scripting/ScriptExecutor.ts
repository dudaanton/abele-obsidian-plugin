import { t } from '@/i18n'
import { Notice, MarkdownView } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

import { AbeleConfig } from '@/services/AbeleConfig'

import { buildScriptContext } from './ScriptContext'

import { showFormModal } from './formModal'
import { waitForScript } from './abort'
import { ScriptRuns, type RunSource } from './ScriptRuns'

import type { ParsedScript, FormField } from './types'

import { ScriptWaitingError } from './ScriptTrust'

import { bookSelection, captureSelection } from './selectionContext'
import {
  runFromSelection,
  type SelectionLaunchTarget,
  type SelectionLaunchOutcome,
} from './runFromSelection'

import { scriptForExecution, assertScriptContext } from './trust/scriptExecutionGate'
import { showScriptApproval } from './trust/scriptApprovalPrompt'

import { compile, safeJson, readOnly } from './scriptCompiler'
import { FormChannel, type PendingForm } from './FormChannel'
import type { ExecuteOptions, ScriptOutcome } from './scriptExecutionTypes'

export interface ScriptAdmission {
  admit(path: string, source: RunSource | 'lint', signal?: AbortSignal): Promise<ParsedScript>
  execute(
    path: string,
    params: Record<string, unknown>,
    options?: AbortSignal | ExecuteOptions
  ): Promise<string>
  showParamForm(
    script: ParsedScript,
    selection?: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown> | null>
}

/** Executes an already indexed script; discovery and name lookup stay in ScriptService. */
export class ScriptExecutor {
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
  private statusBarEl: HTMLElement | null = null

  constructor(private readonly admission: ScriptAdmission) {}

  private admit(path: string, source: RunSource | 'lint', signal?: AbortSignal) {
    return this.admission.admit(path, source, signal)
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
    assertScriptContext(GlobalStore.getInstance().app, script)
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
    this.statusBarEl.setAttribute('aria-label', t('commands.show-script-runs'))

    const only = running.length === 1 ? running[0] : null
    const label = only ? only.name : t('streamC.67b6061a094cd9cf', { v1: String(running.length) })
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
    signal?: AbortSignal,
    toolContext?: import('@/ai/toolContext').ToolContext
  ): Promise<ScriptOutcome> {
    const channel = new FormChannel()

    const run = this.admission.execute(path, params, {
      signal,
      source: 'agent',
      toolContext,
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
    const approvalController = new AbortController()
    const opts: ExecuteOptions = {
      ...given,
      signal: given.signal
        ? AbortSignal.any([given.signal, approvalController.signal])
        : approvalController.signal,
      book,
      selection,
      formHandler: given.formHandler ?? formHandler,
    }
    opts.signal?.throwIfAborted()
    await this.admit(path, opts.source ?? 'agent', opts.signal)
    const script = await scriptForExecution(
      GlobalStore.getInstance().app,
      path,
      opts.allowApprovalPrompt
        ? (request) => showScriptApproval(request, opts.signal, () => approvalController.abort())
        : undefined
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

  /**
   * Runs a saved request's script before or after a send and hands back what it returned. The
   * request, the answer and the environment's values arrive as its `params`. A person who pressed
   * Send may be asked to confirm a script from elsewhere; an agent's send never asks.
   */
  async forRequest(
    path: string,
    params: Record<string, unknown>,
    interactive: boolean,
    signal?: AbortSignal
  ): Promise<unknown> {
    await this.admit(path, interactive ? 'request' : 'agent', signal)
    const script = await scriptForExecution(GlobalStore.getInstance().app, path)
    if (!script.meta.request || script.meta.interceptor)
      throw new Error(
        `Script "${script.meta.name}" does not run around requests: it needs a @request line`
      )
    signal?.throwIfAborted()
    const { value } = await this.run(script, params, {
      signal,
      source: interactive ? 'request' : 'agent',
      ...(interactive ? { formHandler: showFormModal } : {}),
      trigger: 'Saved request',
    })
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
        toolContext: opts.toolContext,
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
        showParams: (script, text, signal) => this.admission.showParamForm(script, text, signal),
        execute: (path, params, options) =>
          this.admission.execute(path, params, { ...options, formHandler: showFormModal }),
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
      const formResult = await this.admission.showParamForm(script)
      if (!formResult) return // user cancelled
      params = formResult
    }

    try {
      const result = await this.admission.execute(path, params, {
        formHandler: showFormModal,
        source: 'command',
        allowApprovalPrompt: true,
      })
      if (result.trim()) {
        new Notice(result.length > 500 ? result.slice(0, 500) + '...' : result, 10000)
      } else {
        new Notice(t('streamC.fab9504c01636dad', { v1: String(script.meta.name) }))
      }
    } catch (err) {
      // Left waiting in the dialog just now: nothing more to say.
      if (err instanceof ScriptWaitingError) return
      const msg = err instanceof Error ? err.message : String(err)
      new Notice(t('streamC.5f7ef21a7e6d0579', { v1: String(msg) }), 10000)
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
    const result = await showFormModal(fields, undefined, signal, script.meta.name)
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
