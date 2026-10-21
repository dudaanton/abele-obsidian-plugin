import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

const source = readFileSync(resolve(__dirname, '../e2e/phoneLayout.e2e.test.ts'), 'utf8')

it('probes nested navigation through the chat switcher and phone tree', () => {
  expect(source.includes('.abele-breadcrumbs')).toBe(false)
  expect(source.includes("await screen('nested comment opened', tree")).toBe(true)
  expect(
    source.includes("if (!tree) throw new Error('Nested comment chat tree did not open')")
  ).toBe(true)
})

const setup = source.slice(source.indexOf("('the chat dialogs on a phone'"))
const hook = setup.match(/beforeEach\(\(context\) => \{([\s\S]*?)\n {2}\}\)/)![1]
const guard = new Function('report', 'context', hook)

it('skips dependent measurements after a failed capture', () => {
  const skip = vi.fn()
  guard({ run: { error: 'Sample capture failure' } }, { task: { name: 'pin geometry' }, skip })
  expect(skip).toHaveBeenCalledExactlyOnceWith(
    'Phone layout capture failed; see reaches every screen'
  )
})

it('keeps the capture case running so it reports the original failure', () => {
  const skip = vi.fn()
  guard(
    { run: { error: 'Sample capture failure' } },
    { task: { name: 'reaches every screen' }, skip }
  )
  expect(skip).not.toHaveBeenCalled()
  expect(setup.includes("expect(report.run?.error ?? '', 'Phone layout capture failed')")).toBe(
    true
  )
  expect(source.includes('e.stack || e.message')).toBe(true)
})

it('runs measurements after a successful capture', () => {
  const skip = vi.fn()
  guard({}, { task: { name: 'pin geometry' }, skip })
  expect(skip).not.toHaveBeenCalled()
})
