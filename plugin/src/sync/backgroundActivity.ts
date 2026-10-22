import { Notice, type App } from 'obsidian'
import { connectionJournalOwner } from './connectionPaths'

type Listener = (owner: string | undefined, text: string) => void
const listeners = new WeakMap<object, Set<Listener>>()
const announced = new WeakMap<object, Set<string>>()

export function observeBackgroundActivity(app: App, listener: Listener): () => void {
  let group = listeners.get(app.vault)
  if (!group) listeners.set(app.vault, (group = new Set()))
  group.add(listener)
  return () => group.delete(listener)
}
export function backgroundActivity(app: App, text: string): void {
  console.debug('[abele-sync]', text)
  for (const listener of listeners.get(app.vault) ?? []) listener(connectionJournalOwner(app), text)
}
/** Only a stop requiring an explicit user decision may interrupt background work. */
export function safetyNotice(app: App, kind: string, text: string): void {
  let kinds = announced.get(app.vault)
  if (!kinds) announced.set(app.vault, (kinds = new Set()))
  if (kinds.has(kind)) return
  kinds.add(kind)
  new Notice(text)
}
