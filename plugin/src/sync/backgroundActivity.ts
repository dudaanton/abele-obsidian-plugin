import { Notice, type App } from 'obsidian'
import { connectionHost, connectionJournalOwner } from './connectionPaths'

type Listener = (owner: string | undefined, text: string) => void
const listeners = new WeakMap<object, Set<Listener>>()
const announced = new WeakMap<object, Set<string>>()

export function observeBackgroundActivity(app: App, listener: Listener): () => void {
  const host = connectionHost(app.vault)
  let group = listeners.get(host)
  if (!group) listeners.set(host, (group = new Set()))
  group.add(listener)
  return () => group.delete(listener)
}
export function backgroundActivity(app: App, text: string): void {
  console.debug('[abele-sync]', text)
  for (const listener of listeners.get(connectionHost(app.vault)) ?? [])
    listener(connectionJournalOwner(app), text)
}
/** Only a stop requiring an explicit user decision may interrupt background work. */
export function safetyNotice(app: App, kind: string, text: string): void {
  const host = connectionHost(app.vault)
  let kinds = announced.get(host)
  if (!kinds) announced.set(host, (kinds = new Set()))
  if (kinds.has(kind)) return
  kinds.add(kind)
  new Notice(text)
}
