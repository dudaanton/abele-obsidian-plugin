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
import { AbeleConfig } from '@/services/AbeleConfig'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { parseScriptHeader, extractScriptBody } from './ScriptParser'
import { buildScriptContext } from './ScriptContext'
import { showFormModal } from './formModal'
import { ScriptRuns, type RunSource } from './ScriptRuns'
import type { ParsedScript, FormField } from './types'
import { ref } from 'vue'

/**
 * How to run a script, beyond which one and with what.
 *
 * `execute` used to take these as trailing arguments and still does — an `AbortSignal` in the
 * third place means the same as it always did — so nothing that called it before has to change.
 */
export interface ExecuteOptions {
  signal?: AbortSignal
  formHandler?: (fields: FormField[]) => Promise<Record<string, string> | null>
  /** Who asked for the run, for the list of runs. Assumed to be an agent when unsaid: that is
   * the one caller that cannot be given a better answer from inside. */
  source?: RunSource
}

export class ScriptService {
  private static instance: ScriptService | null = null

  private scripts = new Map<string, ParsedScript>()
  private commandIds = new Set<string>()
  private watcherCallbackId: symbol | null = null
  private createEventRef: EventRef | null = null
  private statusBarEl: HTMLElement | null = null

  /** Reactive list for settings UI */
  public readonly scriptList = ref<ParsedScript[]>([])

  private constructor() {}

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
    this.discover()
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

  async discover() {
    const config = AbeleConfig.getInstance()
    const folder = config.ai.scriptsFolder
    if (!folder) return

    const { app } = GlobalStore.getInstance()
    const plugin = config.plugin

    // Remove old commands
    this.unregisterAllCommands()
    this.scripts.clear()

    // Find all .js files in the folder
    const files = app.vault
      .getFiles()
      .filter((f) => f.path.startsWith(folder) && f.extension === 'js')

    for (const file of files) {
      try {
        const source = await app.vault.read(file)
        const meta = parseScriptHeader(source)
        if (!meta) {
          console.debug(`[ScriptService] Skipping ${file.path}: no @name header`)
          continue
        }

        const code = extractScriptBody(source)
        const commandId = `abele:script-${sanitize(meta.name)}`

        const parsed: ParsedScript = { path: file.path, meta, code, commandId }
        this.scripts.set(file.path, parsed)

        plugin.addCommand({
          id: commandId,
          name: `Script: ${meta.name}`,
          icon: meta.icon || 'scroll-text',
          callback: () => this.executeFromCommand(file.path),
        })
        this.commandIds.add(commandId)

        console.debug(`[ScriptService] Registered: ${meta.name} (${file.path})`)
      } catch (err) {
        console.error(`[ScriptService] Error parsing ${file.path}:`, err)
      }
    }

    this.scriptList.value = Array.from(this.scripts.values())
    this.cleanupStaleEntries()
  }

  /** Remove stale script entries from toolModes */
  private cleanupStaleEntries() {
    const validToolNames = new Set(
      Array.from(this.scripts.values()).map((s) => `script_${sanitize(s.meta.name)}`)
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
      const ctx = buildScriptContext({
        params,
        signal: combinedController.signal,
        logs,
        formHandler: opts.formHandler ?? formHandler,
        onLog: (text) => runs.append(runId, text),
        onStatus: (text) => {
          runs.setNote(runId, text)
          this.renderStatusBar()
        },
      })

      // Running the user's own script is the feature. The code comes from a `.js` file the
      // user wrote in their own vault, and it is handed only the capabilities in `ctx`; there
      // is no way to execute it without a compiler.
      const fn = new Function(
        'ctx',
        `"use strict";
        return (async () => {
          const { dayjs, read, edit, write, create, remove, move, copy, ls, find, replace, open, setCover, agent, form, log, params, signal, fetch, applyTemplate, listTemplates, createFromTemplate, generateImage, downloadImage, downloadFile, notice, show, runScript, setStatus, activeNotePath } = ctx;
          ${script.code}
        })()`
      )

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

function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
