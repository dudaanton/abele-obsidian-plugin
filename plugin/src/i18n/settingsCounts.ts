import { t } from './index'
const keys = {
  item: 'settings.count.item',
  key: 'settings.count.key',
  file: 'settings.count.file',
  code: 'settings.count.code',
  prompt: 'settings.count.prompt',
  scopeEntry: 'settings.count.scopeEntry',
  event: 'settings.count.event',
  model: 'settings.count.model',
  button: 'settings.count.button',
  tool: 'settings.count.tool',
} as const
export function settingsCount(noun: keyof typeof keys, count: number): string {
  return t(keys[noun], { count })
}
