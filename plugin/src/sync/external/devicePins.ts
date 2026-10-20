import type { App } from 'obsidian'
import { caseKey } from '@abele/sync-sdk/protocol'

export function devicePins(app: Pick<App, 'loadLocalStorage'>): string[] {
  const saved: unknown = app.loadLocalStorage('abele-external-pins-v1') ?? []
  if (!Array.isArray(saved) || saved.some((path) => typeof path !== 'string'))
    throw new Error('Device pin preferences require recovery')
  return saved as string[]
}
export function devicePinned(app: Pick<App, 'loadLocalStorage'>, path: string): boolean {
  return devicePins(app).some((pin) => caseKey(pin) === caseKey(path))
}
