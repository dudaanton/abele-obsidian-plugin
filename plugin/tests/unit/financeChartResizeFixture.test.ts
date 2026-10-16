import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import {
  financeChartResizeFixture,
  financeChartResizeFolder,
} from '../e2e/helpers/financeChartResizeFixture'

describe('finance resize fixture', () => {
  it.each(['USD', 'GBP'])('seeds spending in the selected pinned currency %s', (currency) => {
    const files = financeChartResizeFixture(currency, '2030-04-12')
    const metadata = Object.fromEntries(
      Object.entries(files).map(([path, content]) => {
        expect(content).toMatch(/^---\n[\s\S]+\n---\n$/)
        return [path, load(content.split('---\n')[1]) as Record<string, unknown>]
      })
    )
    expect(metadata['Sample wallet.md']).toMatchObject({
      type: 'account',
      accountType: 'asset',
      currency,
    })
    expect(metadata['Sample spending.md']).toMatchObject({
      type: 'account',
      accountType: 'expense',
    })
    expect(metadata['Sample purchase.md']).toMatchObject({
      type: 'transaction',
      date: '2030-04-12',
      amount: 25,
      currency,
    })
    for (const key of ['from', 'to']) {
      const link = String(metadata['Sample purchase.md'][key]).slice(2, -2)
      expect(link.startsWith(financeChartResizeFolder + '/')).toBe(true)
      expect(metadata[link.slice(financeChartResizeFolder.length + 1) + '.md']).toBeDefined()
    }
  })
})
