import { type ScriptContext } from './ScriptContext'
import { VIEW_GLOBALS } from './view/components'

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
export function safeJson(value: unknown): string {
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
 * The script as a function of its context. Throws what the engine threw, said better.
 *
 * `event`, `book`, `selection`, `books`, `analytics`, `vocabulary`, `message` and `chat` are given in the scope around the script
 * rather than beside the reserved names: they arrived after scripts had been written for years,
 * and all are ordinary names for a variable. Declared out there, a script's own `const event`
 * simply shadows it.
 */
export function compile(code: string): (ctx: ScriptContext) => Promise<unknown> {
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

export function readOnly(ctx: ScriptContext, name: string): ScriptContext {
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
