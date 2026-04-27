import type { AgentTool } from '../client'
import { ScriptService } from '@/scripting/ScriptService'
import type { ScriptParam } from '@/scripting/types'

export function createScriptTools(): AgentTool[] {
  const service = ScriptService.getInstance()
  const scripts = service.getEnabledToolScripts()

  return scripts.map((script) => ({
    name: `script_${sanitize(script.meta.name)}`,
    label: script.meta.name,
    description: script.meta.description || `Run the "${script.meta.name}" script.`,
    parameters: buildJsonSchema(script.meta.params),
    execute: async (_id, params, signal) => {
      const result = await service.execute(script.path, params, signal)
      return { content: [{ type: 'text', text: result || '(no output)' }] }
    },
  }))
}

function buildJsonSchema(params: ScriptParam[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const p of params) {
    properties[p.name] = {
      type: p.type === 'text' ? 'string' : p.type,
      description: p.description,
    }
    if (p.required) required.push(p.name)
  }

  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
  }
}

function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
