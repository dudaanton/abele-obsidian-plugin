import { z } from 'zod'
import type { App } from 'obsidian'
import { matchesRule, type OffloadRule, type OffloadPreview } from './fileActions'
import { externalActionsOf } from './actionHost'

const KEY = 'abele-external-rules-v1'
export const ruleSchema = z.object({
  folder: z.string(),
  extensions: z.array(z.string()),
  minBytes: z.number().nonnegative(),
  unopenedDays: z.number().nonnegative(),
})
export const emptyRule = (): OffloadRule => ({
  folder: '',
  extensions: [],
  minBytes: 0,
  unopenedDays: 0,
})
export function readRule(app: App, connection: string): OffloadRule {
  const saved = app.loadLocalStorage(KEY) ?? {}
  return saved[connection] ? ruleSchema.parse(saved[connection]) : emptyRule()
}
export function saveRule(app: App, connection: string, rule: OffloadRule): void {
  const next = { ...(app.loadLocalStorage(KEY) ?? {}), [connection]: ruleSchema.parse(rule) }
  app.saveLocalStorage(KEY, next)
  if (JSON.stringify(app.loadLocalStorage(KEY)) !== JSON.stringify(next))
    throw new Error('Rule was not saved')
}
export async function previewRule(app: App, connection: string, rule: OffloadRule) {
  ruleSchema.parse(rule)
  const host = externalActionsOf.get(app.vault)
  if (!host) throw new Error('Connections are unavailable')
  const opened = app.loadLocalStorage('abele-external-last-opened-v1') ?? {}
  const paths = app.vault
    .getFiles()
    .filter((file) =>
      matchesRule(rule, {
        path: file.path,
        size: file.stat.size,
        lastOpened: opened[file.path],
      })
    )
    .map((file) => file.path)
  const actions = host.actions(connection)
  return {
    preview: await actions.preview(paths),
    actions: {
      async apply(confirmed: OffloadPreview) {
        const results: { path: string; status: string; reclaimedBytes: number }[] = []
        for (const file of confirmed.files) {
          const local = app.vault.getFileByPath(file.path)
          const history = app.loadLocalStorage('abele-external-last-opened-v1') ?? {}
          if (
            !local ||
            !matchesRule(rule, {
              path: file.path,
              size: local.stat.size,
              lastOpened: history[file.path],
            })
          )
            results.push({ path: file.path, status: 'rule-no-longer-matches', reclaimedBytes: 0 })
          else results.push(...(await actions.apply({ ...confirmed, files: [file] })))
        }
        return results
      },
    },
  }
}
