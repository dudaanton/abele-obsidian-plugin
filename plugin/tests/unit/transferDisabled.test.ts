import { describe, expect, it } from 'vitest'
import { applyEntries, planEntries } from '@/transfer/entries'
import type { AbeleSettings } from '@/services/AbeleConfig'
import type { TransferEntry } from '@/transfer/types'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

const base = () => ({ ai: { ...DEFAULT_AI_SETTINGS }, refreshDelay: 300 }) as AbeleSettings

for (const section of ['automations', 'header-buttons'] as const) {
  describe(`${section} arrive switched off`, () => {
    for (const mode of ['merge', 'replace'] as const) {
      it(`disables new, replaced and unchanged entries in ${mode} mode`, () => {
        for (const enabled of [true, false, undefined]) {
          const item = {
            id: 'sample-action',
            name: 'Sample action',
            enabled,
            scriptName: 'Sample script',
          }
          const entry: TransferEntry = { section, id: item.id, label: item.name, data: item }
          const key = section === 'automations' ? 'automations' : 'headerButtons'
          for (const existing of [[], [item], [{ ...item, name: 'Previous action' }]]) {
            const settings = { ...base(), [key]: existing }
            const next = applyEntries([entry], settings, mode)
            expect(next[key]).toEqual([{ ...item, enabled: false }])
            expect(item.enabled).toBe(enabled)
            expect(settings[key]).toEqual(existing)
          }
        }
      })
    }
    it('plans the same disabled value that will be written', () => {
      const item = { id: 'sample-action', name: 'Sample action', enabled: true }
      const entry: TransferEntry = { section, id: item.id, label: item.name, data: item }
      const key = section === 'automations' ? 'automations' : 'headerButtons'
      const planned = planEntries([entry], { ...base(), [key]: [item] })[0]
      expect(planned.status).toBe('replace')
      expect(planned.entry.data).toEqual({ ...item, enabled: false })
    })
  })
}
