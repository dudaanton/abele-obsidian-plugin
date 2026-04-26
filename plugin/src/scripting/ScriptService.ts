import { TFile, TAbstractFile, debounce, Notice, EventRef } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { parseScriptHeader, extractScriptBody } from './ScriptParser'
import { buildScriptContext } from './ScriptContext'
import type { ParsedScript, FormField } from './types'
import { AgentService } from '@/ai/AgentService'
import { ref } from 'vue'

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

  /** Remove stale entries from scriptToolToggles and allowedScripts */
  private cleanupStaleEntries() {
    const validPaths = new Set(this.scripts.keys())
    const validToolNames = new Set(
      Array.from(this.scripts.values()).map((s) => `script_${sanitize(s.meta.name)}`)
    )

    const config = AbeleConfig.getInstance()
    let dirty = false

    // Clean scriptToolToggles (keyed by path)
    const toggles = config.ai.scriptToolToggles
    if (toggles) {
      for (const path of Object.keys(toggles)) {
        if (!validPaths.has(path)) {
          delete toggles[path]
          dirty = true
        }
      }
    }

    // Clean allowedScripts (keyed by tool name)
    const allowed = config.ai.allowedScripts
    if (allowed) {
      for (const toolName of Object.keys(allowed)) {
        if (!validToolNames.has(toolName)) {
          delete allowed[toolName]
          dirty = true
        }
      }
    }

    // Also clean per-chat allowedScripts on active session
    const agent = AgentService.getInstance()
    const session = agent.activeSession.value
    if (session) {
      const chatAllowed = session.allowedScripts.value
      for (const toolName of Object.keys(chatAllowed)) {
        if (!validToolNames.has(toolName)) {
          delete chatAllowed[toolName]
        }
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
    return this.getAll()
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

  async execute(
    path: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    formHandler?: (fields: FormField[]) => Promise<Record<string, string> | null>
  ): Promise<string> {
    const script = this.scripts.get(path)
    if (!script) throw new Error(`Script not found: ${path}`)

    const timeoutSignal = AbortSignal.timeout(60_000)
    const combinedController = new AbortController()

    const onAbort = () => combinedController.abort()
    signal?.addEventListener('abort', onAbort)
    timeoutSignal.addEventListener('abort', onAbort)

    const logs: string[] = []

    try {
      const ctx = buildScriptContext({
        params,
        signal: combinedController.signal,
        logs,
        formHandler,
      })

      const fn = new Function(
        'ctx',
        `"use strict";
        return (async () => {
          const { read, edit, create, remove, move, copy, ls, find, agent, form, log, params, signal, fetch, applyTemplate, listTemplates, generateImage, downloadImage, downloadFile, notice, runScript, setStatus } = ctx;
          ${script.code}
        })()`
      )

      const result = await fn(ctx)
      const output = logs.length ? logs.join('\n') + '\n' : ''
      const resultStr =
        result !== undefined
          ? typeof result === 'object'
            ? JSON.stringify(result, null, 2)
            : String(result)
          : ''
      return output + resultStr
    } finally {
      this.clearStatus()
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
      const result = await this.execute(path, params, undefined, (fields) =>
        this.showFormModal(fields)
      )
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

  private showParamForm(script: ParsedScript): Promise<Record<string, string> | null> {
    const fields: FormField[] = script.meta.params.map((p) => ({
      name: p.name,
      label: p.description || p.name,
      type: 'text' as const,
      required: p.required,
    }))
    return this.showFormModal(fields)
  }

  /**
   * Show a form modal and return the values.
   * This resolves when the user submits or null on cancel.
   */
  private showFormModal(fields: FormField[]): Promise<Record<string, string> | null> {
    const store = GlobalStore.getInstance()
    return new Promise((resolve) => {
      store.scriptFormFields.value = fields
      store.scriptFormResolve.value = resolve
      store.scriptFormModalOpened.value = true
    })
  }
}

function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
