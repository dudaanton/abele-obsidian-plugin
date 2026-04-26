import { Notice, requestUrl } from 'obsidian'
import { nanoid } from 'nanoid'
import type { AgentTool, ModelConfig } from '@/ai/client'
import { AbeleConfig } from '@/services/AbeleConfig'
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
import { createGenerateImageTool } from '@/ai/tools/GenerateImageTool'
import { createDownloadImageTool, createDownloadFileTool } from '@/ai/tools/DownloadImageTool'
import { runSubAgent } from '@/ai/SubAgentRunner'
import { AgentService } from '@/ai/AgentService'
import { createAgentTools } from '@/ai/tools'
import { substituteSecrets } from '@/ai/tools/secretUtils'
import type { FormField } from './types'

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

/** Strip "Saved: " or "Created: " prefix from tool results to return clean paths */
function stripPrefix(result: string): string {
  return result.replace(/^(?:Saved|Created):\s*/, '')
}

function resolveModelBySlot(
  slot: 'activeModelId' | 'wiseModelId' | 'delegateModelId'
): ModelConfig | null {
  const config = AbeleConfig.getInstance().ai
  const modelId = config[slot]
  if (!modelId) return null
  for (const provider of config.providers) {
    const model = provider.models.find((m) => m.id === modelId)
    if (model) {
      return {
        id: model.id,
        name: model.name,
        baseUrl: provider.baseUrl,
        apiKey: GlobalStore.getInstance().app.secretStorage.getSecret(provider.apiKeyId) || '',
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        supportsReasoning: model.supportsReasoning,
      }
    }
  }
  return null
}

export function buildScriptContext(opts: {
  params: Record<string, unknown>
  signal: AbortSignal
  logs: string[]
  formHandler?: (fields: FormField[]) => Promise<Record<string, string> | null>
}) {
  const s = opts.signal

  // Lazily created tool instances
  const readTool = createReadFileTool()
  const editTool = createEditFileTool()
  const createTool = createCreateFileTool()
  const deleteTool = createDeleteFileTool()
  const moveTool = createMoveFileTool()
  const copyTool = createCopyFileTool()
  const lsTool = createLsTool()
  const findTool = createFindTool()
  const applyTemplateTool = createApplyTemplateTool()
  const listTemplatesTool = createListTemplatesTool()
  const generateImageTool = createGenerateImageTool()
  const downloadImageTool = createDownloadImageTool()
  const downloadFileTool = createDownloadFileTool()

  return {
    params: opts.params,
    signal: s,

    // ── Logging ──

    log(...args: unknown[]) {
      opts.logs.push(
        args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
      )
    },

    // ── File operations ──

    read: (path: string) => call(readTool, { path }, s),

    async edit(path: string, oldString: string, newString: string) {
      await call(editTool, { path, old_string: oldString, new_string: newString }, s)
    },

    async create(path: string, content: string) {
      await call(createTool, { path, content }, s)
    },

    async remove(path: string) {
      await call(deleteTool, { path }, s)
    },

    async move(from: string, to: string) {
      await call(moveTool, { from, to }, s)
    },

    async copy(from: string, to: string) {
      await call(copyTool, { from, to }, s)
    },

    async ls(path?: string): Promise<string[]> {
      const result = await call(lsTool, { path: path ?? '' }, s)
      return result ? result.split('\n').filter(Boolean) : []
    },

    async find(findOpts: {
      name?: string
      property?: string
      value?: string
      content?: string
    }): Promise<string[]> {
      const result = await call(findTool, findOpts, s)
      return result ? result.split('\n').filter(Boolean) : []
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

    async downloadImage(url: string, filename?: string): Promise<string> {
      return stripPrefix(await call(downloadImageTool, { url, filename }, s))
    },

    async downloadFile(url: string, filename?: string, extension?: string): Promise<string> {
      return stripPrefix(await call(downloadFileTool, { url, filename, extension }, s))
    },

    // ── AI ──

    async agent(
      task: string,
      agentOpts?: { model?: 'primary' | 'delegate' | 'wise' }
    ): Promise<string> {
      const agentService = AgentService.getInstance()
      const modelType = agentOpts?.model ?? 'delegate'
      const model =
        modelType === 'wise'
          ? (resolveModelBySlot('wiseModelId') ?? agentService.getDelegateModelConfig())
          : modelType === 'primary'
            ? (resolveModelBySlot('activeModelId') ?? agentService.getDelegateModelConfig())
            : agentService.getDelegateModelConfig()
      const session = agentService.activeSession.value
      const systemPrompt = await agentService.getDelegateSystemPrompt(session!)
      const allTools = createAgentTools()
      const tools = allTools.filter((t) => t.name !== 'delegate')
      const permissions = session!.getPermissions()

      return runSubAgent({ systemPrompt, userMessage: task, tools, model, signal: s }, permissions)
    },

    async generateImage(prompt: string): Promise<string> {
      const result = await generateImageTool.execute(nanoid(), { prompt }, s)
      const imagePath = (result.details as any)?.imagePath
      if (imagePath) return imagePath
      return stripPrefix(text(result).replace(/^.*Image saved:\s*/s, ''))
    },

    // ── Scripts ──

    async runScript(name: string, scriptParams?: Record<string, unknown>): Promise<string> {
      const { ScriptService } = await import('./ScriptService')
      const service = ScriptService.getInstance()
      const script = service.getAll().find((sc) => sc.meta.name === name)
      if (!script) throw new Error(`Script not found: ${name}`)
      return service.execute(script.path, scriptParams || {}, s)
    },

    // ── UI ──

    notice(message: string, timeout?: number) {
      new Notice(message, timeout)
    },

    async setStatus(statusText: string) {
      const { ScriptService } = await import('./ScriptService')
      ScriptService.getInstance().setStatus(statusText)
    },

    async form(fields: FormField[]): Promise<Record<string, string> | null> {
      if (!opts.formHandler) {
        throw new Error(
          'Form input is only available when the script is run from the command palette.'
        )
      }
      return opts.formHandler(fields)
    },
  }
}

export type ScriptContext = ReturnType<typeof buildScriptContext>
