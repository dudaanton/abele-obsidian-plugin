import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LOAD_MARKS } from '@/helpers/loadMarks'
import { evalJson } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

describe('startup marks with and without AI', () => {
  let enabled: boolean
  beforeAll(() => {
    enabled = evalJson('window.__abeleTest.AbeleConfig.getInstance().ai.enabled')
  })
  afterAll(() => {
    evalAsync(`(async () => {
      const config = window.__abeleTest.AbeleConfig.getInstance()
      config.ai.enabled = ${enabled}
      await config.saveSettings()
      await app.plugins.disablePlugin('abele')
      await app.plugins.enablePlugin('abele')
      return true
    })()`)
  })
  it.each([false, true])('leaves all six marks in lifecycle order with AI=%s', (ai) => {
    const marks = evalAsync<Record<string, number>>(`(async () => {
      const config = window.__abeleTest.AbeleConfig.getInstance()
      config.ai.enabled = ${ai}
      await config.saveSettings()
      await app.plugins.disablePlugin('abele')
      const names = ${JSON.stringify(LOAD_MARKS)}
      for (const name of Object.values(names)) performance.clearMarks(name)
      await app.plugins.enablePlugin('abele')
      return Object.fromEntries(Object.entries(names).map(([key, name]) => {
        const entries = performance.getEntriesByName(name, 'mark')
        return [key, entries.length === 1 ? entries[0].startTime : null]
      }))
    })()`)
    const order = ['evalStart', 'evalEnd', 'onloadStart', 'layoutStart', 'layoutEnd', 'onloadEnd']
    order.forEach((key, i) => {
      expect(typeof marks[key], key).toBe('number')
      if (i) expect(marks[key], key).toBeGreaterThanOrEqual(marks[order[i - 1]])
    })
  })
})
