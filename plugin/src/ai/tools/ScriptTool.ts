import type { AgentTool } from '../client'
import { ScriptService, type ScriptOutcome } from '@/scripting/ScriptService'
import type { FormField, ScriptParam } from '@/scripting/types'

export function createScriptTools(): AgentTool[] {
  const service = ScriptService.getInstance()
  const scripts = service.getEnabledToolScripts()

  return scripts.map((script) => ({
    name: `script_${sanitize(script.meta.name)}`,
    label: script.meta.name,
    description: script.meta.description || `Run the "${script.meta.name}" script.`,
    parameters: buildJsonSchema(script.meta.params),
    execute: async (_id, params, signal) => {
      const outcome = await service.executeForAgent(script.path, params, signal)
      return { content: [{ type: 'text', text: describe(outcome) }] }
    },
  }))
}

/**
 * Either what the script said, or what it is waiting to be told.
 *
 * A script that asks for parameters is not a failure any more: the question comes back as a
 * form to fill in and the run stays alive holding it open.
 */
function describe(outcome: ScriptOutcome): string {
  if (outcome.kind === 'done') return outcome.output || '(no output)'

  const fields = outcome.fields.map(describeField)
  return [
    `This script needs input before it can go on. It is still running, waiting for it.`,
    `Answer with the \`answer_form\` tool: run_id "${outcome.runId}", and \`values\` as JSON`,
    `keyed by field name. Ask the person if any of it is theirs to decide.`,
    '',
    JSON.stringify(fields, null, 2),
  ].join('\n')
}

/** A field as the model needs it: what to call it, what it takes, what it already suggests. */
function describeField(field: FormField): Record<string, unknown> {
  // A markdown field asks for nothing — it is a paragraph the form shows a person — so it
  // travels as the note it is rather than as something to fill in.
  if (field.type === 'markdown') return { note: field.text ?? field.label }

  return {
    name: field.name,
    label: field.label,
    type: field.type ?? 'text',
    ...(field.options ? { options: field.options } : {}),
    ...(field.default !== undefined ? { default: field.default } : {}),
    ...(field.required ? { required: true } : {}),
  }
}

/**
 * Sends the answers into a script that stopped to ask for them.
 *
 * Separate from the script's own tool because it is a different act on a different subject: the
 * script tool starts a run, this one answers one that is already going.
 */
export function createAnswerFormTool(): AgentTool {
  const service = ScriptService.getInstance()

  return {
    name: 'answer_form',
    label: 'Answer form',
    description:
      'Send parameters into a script that stopped to ask for them. `run_id` is the one the ' +
      'script tool answered with, and `values` is a JSON object keyed by field name. The ' +
      'script goes on from where it stopped, and may finish or ask again. Set `cancel` to ' +
      'true to tell it nobody is answering, which is what dismissing its dialog would do.',
    parameters: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'The run that is waiting.' },
        values: {
          type: 'string',
          description: 'JSON object of field name to value, e.g. `{"word":"apple"}`.',
        },
        cancel: {
          type: 'boolean',
          description: 'Answer nothing, as dismissing the dialog would.',
        },
      },
      required: ['run_id'],
    },
    execute: async (_id, params) => {
      const runId = typeof params.run_id === 'string' ? params.run_id : ''
      const cancel = params.cancel === true
      const values = cancel ? null : readValues(params.values)

      if (!cancel && !values) {
        return {
          content: [
            {
              type: 'text',
              text: '`values` has to be a JSON object keyed by field name, or `cancel` true.',
            },
          ],
        }
      }

      const outcome = await service.answerForm(runId, values)
      if (!outcome) {
        return {
          content: [
            {
              type: 'text',
              text: `No run "${runId}" is waiting for input. It has finished, been stopped, or was never asked.`,
            },
          ],
        }
      }

      return { content: [{ type: 'text', text: describe(outcome) }] }
    },
  }
}

/** The values as an object, or nothing when they are not one. */
function readValues(raw: unknown): Record<string, string> | null {
  const parsed = typeof raw === 'string' ? tryParse(raw) : raw
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    values[key] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  return values
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
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
