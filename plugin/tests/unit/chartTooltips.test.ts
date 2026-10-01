import { escapeHtml } from '@/helpers/escapeHtml'
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

it('does not interpolate note names directly into HTML tooltip formatters', () => {
  for (const file of [
    'bases/ChartView.ts',
    'components/FinanceSidebar.vue',
    'components/TimeEntryListView.vue',
    'components/TimeTrackingSidebar.vue',
  ]) {
    const source = readFileSync(resolve(__dirname, '../../src', file), 'utf8')
    expect(source, file).not.toMatch(/\$\{\s*(params|p)\.(name|seriesName)\s*\}/)
  }
})

it('keeps names and property values as literal tooltip text', () => {
  const name = '<img src="sample" onerror="sample()"> & sample'
  const tooltip = document.createElement('div')
  tooltip.innerHTML = `<b>${escapeHtml(name)}</b><br>${escapeHtml(42)}`
  expect(tooltip.querySelector('img')).toBeNull()
  expect(tooltip.textContent).toBe(`${name}42`)
})

it('uses the patched chart library version', () => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(resolve(__dirname, '../../package-lock.json'), 'utf8'))
  expect(pkg.dependencies.echarts).toBe('6.1.0')
  expect(lock.packages['node_modules/echarts'].version).toBe('6.1.0')
})
