import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type AbeleSettings } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { applyEntries, collectEntries } from '@/transfer/entries'

const retired = {
  wiseModelId: 'sample-model',
  systemPrompt: 'Sample retired instructions',
  systemPromptFromNote: true,
  systemPromptNotePath: 'Notes/sample-instructions.md',
  allowWebSearch: true,
  allowFetch: true,
  allowWiseModel: true,
}
const settings = (): AbeleSettings =>
  ({
    ...DEFAULT_SETTINGS,
    ai: { ...DEFAULT_AI_SETTINGS, ...retired, interceptors: [{ id: 'sample-retired' }] },
  }) as AbeleSettings

describe('retired AI transfer fields', () => {
  it('does not offer migration-only fields or the retired interceptor list', () => {
    const entries = collectEntries(settings())
    const general = entries.find((entry) => entry.section === 'ai-general')!.data
    for (const key of Object.keys(retired)) expect(general).not.toHaveProperty(key)
    expect(entries.some((entry) => entry.section === 'ai-interceptors')).toBe(false)
  })

  it.each(['merge', 'replace'] as const)(
    'ignores retired incoming fields in %s mode, retaining local migration data',
    (mode) => {
      const current = settings()
      const result = applyEntries(
        [
          {
            section: 'ai-general',
            id: 'ai-general',
            label: 'AI general',
            data: {
              enabled: false,
              ...Object.fromEntries(Object.keys(retired).map((key) => [key, 'incoming'])),
            },
          },
          {
            section: 'ai-interceptors',
            id: 'sample-new',
            label: 'Retired',
            data: { id: 'sample-new' },
          },
        ],
        current,
        mode
      )
      expect(result.ai!.enabled).toBe(false)
      for (const [key, value] of Object.entries(retired))
        expect(result.ai).toHaveProperty(key, value)
      expect(result.ai!.interceptors).toEqual(current.ai!.interceptors)
    }
  )
})
