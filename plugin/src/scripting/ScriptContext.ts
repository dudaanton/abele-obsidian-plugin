import { MarkdownView, Notice, requestUrl, TFile } from 'obsidian'
import dayjs from 'dayjs'
import { nanoid } from 'nanoid'
import type { AgentTool } from '@/ai/client'
import { GlobalStore } from '@/stores/GlobalStore'
import { createReadFileTool } from '@/ai/tools/ReadFileTool'
import { createEditFileTool } from '@/ai/tools/EditFileTool'
import { createCreateFileTool } from '@/ai/tools/CreateFileTool'
import { createDeleteFileTool } from '@/ai/tools/DeleteFileTool'
import { createMoveFileTool } from '@/ai/tools/MoveFileTool'
import { createCopyFileTool } from '@/ai/tools/CopyFileTool'
import { createLsTool } from '@/ai/tools/LsTool'
import { createFindTool } from '@/ai/tools/FindTool'
import { createApplyTemplateTool, createListTemplatesTool } from '@/ai/tools/TemplateTool'
import { createReplaceTool } from '@/ai/tools/ReplaceTool'
import { createWriteFileTool } from '@/ai/tools/WriteFileTool'
import { createGenerateImageTool } from '@/ai/tools/GenerateImageTool'
import { createDownloadImageTool, createDownloadFileTool } from '@/ai/tools/DownloadImageTool'
import { runSubAgent } from '@/ai/SubAgentRunner'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { createAgentTools } from '@/ai/tools'
import { substituteSecrets } from '@/ai/tools/secretUtils'
import type { FormField } from './types'
import { View, type RestoreInfo, type ViewHost, type ViewOptions } from './view/View'
import { VIEW_GLOBALS } from './view/components'
import { defaultViewHost } from './view/host'
import { showFormModal } from './formModal'

/** Extract first text content from tool result */
function text(result: { content: Array<{ type: string; text?: string }> }): string {
  const item = result.content.find((c) => c.type === 'text')
  return item?.text ?? ''
}

/** Shorthand: call a tool and return its text result */
async function call(
  tool: AgentTool,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> {
  return text(await tool.execute(nanoid(), params, signal))
}

/**
 * Calls a tool that writes a file and returns where it ended up.
 *
 * Not always where it was asked to: a name carrying a `#` is cleaned on the way in, and a
 * script that went on to link to the name it passed would be linking to nothing.
 */
async function callForPath(
  tool: AgentTool,
  params: Record<string, unknown>,
  fallback: string,
  signal?: AbortSignal
): Promise<string> {
  const result = await tool.execute(nanoid(), params, signal)
  const details = result.details as { path?: string } | undefined
  return details?.path ?? fallback
}

/** Strip "Saved: " or "Created: " prefix from tool results to return clean paths */
function stripPrefix(result: string): string {
  return result.replace(/^(?:Saved|Created):\s*/, '')
}

export function buildScriptContext(opts: {
  params: Record<string, unknown>
  signal: AbortSignal
  logs: string[]
  formHandler?: (fields: FormField[]) => Promise<Record<string, string> | null>
  /** Told each line as it is printed, so a run can be watched rather than only read after. */
  onLog?: (text: string) => void
  /** Told what the script says it is doing, when there is a run to attribute it to. */
  onStatus?: (text: string) => void
  /** Which script this is, by the name it declares. A view saves it to run the script again. */
  scriptName?: string
  /** Set when a saved tab is being rebuilt: the leaf that waits and the state it kept. */
  restore?: RestoreInfo
  /** Test seam; production resolves the service through `defaultViewHost()`. */
  viewHost?: ViewHost
}) {
  const s = opts.signal

  const skipScope = { skipScope: true }
  const readTool = createReadFileTool(skipScope)
  const editTool = createEditFileTool(skipScope)
  const writeTool = createWriteFileTool(skipScope)
  const createTool = createCreateFileTool(skipScope)
  const deleteTool = createDeleteFileTool(skipScope)
  const moveTool = createMoveFileTool(skipScope)
  const copyTool = createCopyFileTool(skipScope)
  const lsTool = createLsTool(skipScope)
  const findTool = createFindTool(skipScope)
  const replaceTool = createReplaceTool(skipScope)
  const applyTemplateTool = createApplyTemplateTool()
  const listTemplatesTool = createListTemplatesTool()
  const generateImageTool = createGenerateImageTool()
  const downloadImageTool = createDownloadImageTool()
  const downloadFileTool = createDownloadFileTool()

  const views: View[] = []

  /**
   * A form needs someone to answer it. A script started by an agent has nobody — that is what
   * the error below is for — but a view's handlers run because a person pressed something,
   * so from the moment a view is open the ordinary modal is the right answer.
   */
  const formHandlerNow = ():
    | ((fields: FormField[]) => Promise<Record<string, string> | null>)
    | null => {
    if (opts.formHandler) return opts.formHandler
    if (views.some((v) => v.isOpen)) return showFormModal
    return null
  }

  return {
    params: opts.params,
    signal: s,
    dayjs,

    // ── Logging ──

    log(...args: unknown[]) {
      const line = args
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ')
      opts.logs.push(line)
      opts.onLog?.(line)
    },

    // ── Workspace ──

    activeNotePath(): string | null {
      const { app } = GlobalStore.getInstance()
      const view = app.workspace.getActiveViewOfType(MarkdownView)
      return view?.file?.path ?? null
    },

    // ── File operations ──

    read: (path: string) => call(readTool, { path }, s),

    async edit(path: string, oldString: string, newString: string) {
      await call(editTool, { path, old_string: oldString, new_string: newString }, s)
    },

    async write(path: string, content: string) {
      await call(writeTool, { path, content }, s)
    },

    /** Returns the path the file was actually created at — see `callForPath`. */
    async create(path: string, content: string): Promise<string> {
      return callForPath(createTool, { path, content }, path, s)
    },

    async remove(path: string) {
      await call(deleteTool, { path }, s)
    },

    /** Returns where the file ended up, which may not be `to`. */
    async move(from: string, to: string): Promise<string> {
      return callForPath(moveTool, { from, to }, to, s)
    },

    /** Returns where the copy ended up, which may not be `to`. */
    async copy(from: string, to: string): Promise<string> {
      return callForPath(copyTool, { from, to }, to, s)
    },

    async ls(path?: string): Promise<string[]> {
      const result = await call(lsTool, { path: path ?? '' }, s)
      if (!result || result.startsWith('(')) return []
      return result.split('\n').filter(Boolean)
    },

    async find(findOpts: {
      name?: string
      property?: string
      value?: string
      content?: string
      criteria?: Array<{
        type: 'path' | 'name' | 'property' | 'content'
        operator: string
        property?: string
        value?: string
      }>
      include_frontmatter?: boolean
      limit?: number
    }): Promise<string[]> {
      // Convert shorthand params to criteria format
      const criteria = findOpts.criteria ? [...findOpts.criteria] : []
      if (findOpts.name) {
        criteria.push({ type: 'name', operator: 'contains', value: findOpts.name })
      }
      if (findOpts.property) {
        criteria.push(
          findOpts.value
            ? {
                type: 'property',
                operator: 'equals',
                property: findOpts.property,
                value: findOpts.value,
              }
            : { type: 'property', operator: 'exists', property: findOpts.property }
        )
      }
      if (findOpts.content) {
        criteria.push({ type: 'content', operator: 'contains', value: findOpts.content })
      }
      if (!criteria.length) return []
      const result = await call(
        findTool,
        { criteria, include_frontmatter: findOpts.include_frontmatter, limit: findOpts.limit },
        s
      )
      if (!result || result === 'No files found.' || result === 'No criteria provided.') return []
      // Strip the "N files:" / "N of M files:" header line
      const lines = result.split('\n').filter(Boolean)
      if (lines[0]?.match(/^\d+.*files?:/)) lines.shift()
      return lines
    },

    async replace(
      path: string,
      actions: Array<{
        type:
          | 'set-property'
          | 'remove-property'
          | 'add-to-list'
          | 'remove-from-list'
          | 'replace-in-list'
          | 'replace-in-content'
          | 'replace-in-property'
          | 'move'
        property?: string
        value?: string
        old_value?: string
        directory?: string
      }>
    ): Promise<string> {
      return call(replaceTool, { path, actions }, s)
    },

    async open(path: string) {
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)
      await app.workspace.getLeaf(false).openFile(file)
    },

    // ── Templates ──

    async applyTemplate(
      path: string,
      variables?: Record<string, string | string[]>
    ): Promise<string> {
      return stripPrefix(await call(applyTemplateTool, { path, variables: variables || {} }, s))
    },

    async listTemplates(type?: string): Promise<string> {
      return call(listTemplatesTool, { type }, s)
    },

    async createFromTemplate(templatePath: string): Promise<void> {
      const { getTemplateComposable } = await import('@/composables/useTemplates')
      await getTemplateComposable().startCreateFlowWithTemplate(templatePath)
    },

    // ── Network ──

    async fetch(
      url: string,
      fetchOpts?: { method?: string; headers?: Record<string, string>; body?: string }
    ): Promise<{ status: number; headers: Record<string, string>; data: any; text: string }> {
      const headers: Record<string, string> = {}
      if (fetchOpts?.headers) {
        for (const [k, v] of Object.entries(fetchOpts.headers)) {
          headers[k] = substituteSecrets(v)
        }
      }
      const response = await requestUrl({
        url: substituteSecrets(url),
        method: fetchOpts?.method || 'GET',
        headers,
        body: fetchOpts?.body ? substituteSecrets(fetchOpts.body) : undefined,
        throw: false,
      })
      const contentType = response.headers['content-type'] || ''
      let data: any = response.text
      if (contentType.includes('application/json')) {
        try {
          data = response.json
        } catch {
          /* keep text */
        }
      }
      return { status: response.status, headers: response.headers, data, text: response.text }
    },

    async downloadImage(
      url: string,
      filenameOrOpts?: string | { filename?: string; headers?: Record<string, string> }
    ): Promise<string> {
      const opts =
        typeof filenameOrOpts === 'string' ? { filename: filenameOrOpts } : filenameOrOpts
      return stripPrefix(await call(downloadImageTool, { url, ...opts }, s))
    },

    async downloadFile(
      url: string,
      opts?: {
        filename?: string
        extension?: string
        method?: string
        headers?: Record<string, string>
        body?: string
      }
    ): Promise<string> {
      return stripPrefix(await call(downloadFileTool, { url, ...opts }, s))
    },

    // ── AI ──

    /**
     * Hands a task to an agent and returns what it came back with.
     *
     * Pass `items` to fan out — one sub-agent per item, results in the same order. Which agent
     * runs is a deliberate choice now: the old `{ model: 'primary' | 'delegate' | 'wise' }`
     * presets are gone along with those slots.
     */
    async agent(
      task: string,
      agentOpts?: { agent?: string; items?: string[]; batchSize?: number }
    ): Promise<string | string[]> {
      const registry = AgentRegistry.getInstance()
      const requested = agentOpts?.agent
      const target = requested ? registry.resolve(requested) : registry.defaultAgent()

      if (!target) {
        const available = registry
          .list({ includeUtility: true })
          .map((a) => a.name)
          .join(', ')
        throw new Error(
          requested
            ? `Agent "${requested}" not found. Available: ${available || 'none'}`
            : 'No agent is configured'
        )
      }

      const model = registry.resolveModel(target)
      if (!model) throw new Error(`Agent "${target.name}" has no usable model configured`)

      const systemPrompt = await registry.buildSystemPrompt(target)
      const tools = registry.filterTools(target, createAgentTools())
      const items = agentOpts?.items ?? []

      const runOne = (message: string) =>
        runSubAgent(
          { systemPrompt, userMessage: message, tools, model, signal: s },
          target.toolModes
        )

      if (!items.length) return runOne(task)

      const batchSize = Math.min(Math.max(agentOpts?.batchSize ?? 5, 1), 10)
      const results: string[] = []
      for (let i = 0; i < items.length; i += batchSize) {
        const slice = items.slice(i, i + batchSize)
        results.push(...(await Promise.all(slice.map((item) => runOne(`${task}\n\n${item}`)))))
      }
      return results
    },

    /** The agents a script can choose between. */
    agents(): Array<{ id: string; name: string; description: string; utility: boolean }> {
      return AgentRegistry.getInstance()
        .list({ includeUtility: true })
        .map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          utility: a.utility,
        }))
    },

    async generateImage(prompt: string, model?: string): Promise<string> {
      const result = await generateImageTool.execute(nanoid(), { prompt, model }, s)
      const imagePath = (result.details as any)?.imagePath
      if (imagePath) return imagePath
      return stripPrefix(text(result).replace(/^.*Image saved:\s*/s, ''))
    },

    // ── Zip ──

    async unzip(zipPath: string, targetFolder?: string): Promise<string[]> {
      const { unzipSync } = await import('fflate')
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(zipPath)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${zipPath}`)

      const folder = targetFolder ?? zipPath.replace(/\.zip$/i, '')

      const buf = await app.vault.readBinary(file)
      const entries = unzipSync(new Uint8Array(buf))

      const created: string[] = []
      for (const [name, data] of Object.entries(entries)) {
        if (name.endsWith('/')) continue // skip directories
        const path = `${folder}/${name}`
        const dir = path.split('/').slice(0, -1).join('/')
        if (dir && !app.vault.getAbstractFileByPath(dir)) {
          await app.vault.createFolder(dir)
        }
        await app.vault.createBinary(path, data.buffer as ArrayBuffer)
        created.push(path)
      }
      return created
    },

    // ── Vault helpers ──

    async setCover(notePath: string, mediaPath?: string) {
      const { setCoverFromMedia, findFirstMedia } = await import('@/commands/setCover')
      const { app } = GlobalStore.getInstance()
      const noteFile = app.vault.getAbstractFileByPath(notePath)
      if (!(noteFile instanceof TFile)) throw new Error(`Note not found: ${notePath}`)

      if (mediaPath) {
        const mediaFile = app.vault.getAbstractFileByPath(mediaPath)
        if (!(mediaFile instanceof TFile)) throw new Error(`Media not found: ${mediaPath}`)
        await setCoverFromMedia(mediaFile, noteFile)
      } else {
        const content = await app.vault.cachedRead(noteFile)
        const media = findFirstMedia(content, notePath)
        if (!media) throw new Error('No image or video found in note')
        await setCoverFromMedia(media, noteFile)
      }
    },

    // ── Scripts ──

    async runScript(name: string, scriptParams?: Record<string, unknown>): Promise<string> {
      const { ScriptService } = await import('./ScriptService')
      const service = ScriptService.getInstance()
      const script = service.getAll().find((sc) => sc.meta.name === name)
      if (!script) throw new Error(`Script not found: ${name}`)
      return service.execute(script.path, scriptParams || {}, { signal: s, source: 'script' })
    },

    // ── Views ──

    /**
     * A tab of the script's own. The first view made in a run is the one a restored tab
     * rebuilds, so it alone receives the saved state.
     */
    view(viewOpts: ViewOptions): View {
      const restore = views.length === 0 ? opts.restore : undefined
      const v = new View(
        viewOpts,
        opts.viewHost ?? defaultViewHost(),
        { script: opts.scriptName ?? '', params: opts.params },
        restore
      )
      views.push(v)
      return v
    },

    ...VIEW_GLOBALS,

    // ── UI ──

    notice(message: string, timeout?: number) {
      new Notice(message, timeout)
    },

    async setStatus(statusText: string) {
      if (opts.onStatus) {
        opts.onStatus(statusText)
        return
      }
      const { ScriptService } = await import('./ScriptService')
      ScriptService.getInstance().setStatus(statusText)
    },

    async form(fields: FormField[]): Promise<Record<string, string> | null> {
      const handler = formHandlerNow()
      if (!handler) {
        throw new Error(
          'Form input is only available when the script is run from the command palette or has a view open.'
        )
      }
      return handler(fields)
    },

    /**
     * Puts a piece of markdown in front of the user to read.
     *
     * A notice is the wrong place for anything long: it is truncated, it goes away by itself,
     * and its text cannot be selected. This is a form that asks nothing — the same modal,
     * rendering the text and offering only a way to close it — so a script can hand back
     * something worth reading rather than a fragment of it.
     */
    async show(text: string, title?: string): Promise<void> {
      const handler = formHandlerNow()
      if (!handler) {
        throw new Error(
          'Showing text is only available when the script is run from the command palette or has a view open.'
        )
      }
      await handler([{ name: 'text', label: title ?? '', type: 'markdown', text }])
    },
  }
}

export type ScriptContext = ReturnType<typeof buildScriptContext>
