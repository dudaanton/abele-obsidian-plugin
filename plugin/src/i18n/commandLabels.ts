import { en } from './locales/en/pilot'
import { createTranslator } from './core'

const english = createTranslator('en', { en })

/** A saved user label keeps its original default independently of the UI language. */
export function defaultCommandLabel(
  command: { id: string; name: string },
  scripts: readonly { commandId: string; meta: { name: string } }[] = []
): string {
  if (!command.id.startsWith('abele:')) return command.name
  const script = scripts.find((script) => script.commandId === command.id)
  if (script) return english('commands.script', { name: script.meta.name })
  const id = command.id.slice('abele:'.length)
  const key = id === 'review-waiting-scripts' ? 'commands.review-scripts' : `commands.${id}`
  if (Object.hasOwn(en, key)) return english(key)
  return command.name
}
