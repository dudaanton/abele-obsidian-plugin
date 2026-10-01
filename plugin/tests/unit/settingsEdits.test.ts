import { expect, it } from 'vitest'
import { SettingsEdits } from '@/services/settingsEdits'

it('merges only changed nested fields and treats lists as complete values', () => {
  const edits = new SettingsEdits()
  edits.record(
    { ai: { enabled: false, models: [] } },
    { ai: { enabled: true, models: ['sample'] } }
  )
  expect(
    edits.apply({ ai: { enabled: false, models: ['remote'], folder: 'Incoming' }, delay: 777 })
  ).toEqual({ ai: { enabled: true, models: ['sample'], folder: 'Incoming' }, delay: 777 })
})

it('keeps newer edits made during an awaited write', () => {
  const edits = new SettingsEdits()
  edits.record({ name: 'old' }, { name: 'first' })
  const written = edits.written()
  edits.record({ name: 'first' }, { name: 'second' })
  written()
  expect(edits.apply({ name: 'remote' })).toEqual({ name: 'second' })
  edits.written()()
  expect(edits.apply({ name: 'remote' })).toEqual({ name: 'remote' })
})

it('preserves explicit deletion and an edit reverted before writing', () => {
  const edits = new SettingsEdits()
  edits.record({ prompts: { extra: 'sample' }, enabled: false }, { prompts: {}, enabled: true })
  edits.record({ enabled: true }, { enabled: false })
  expect(edits.apply({ prompts: { extra: 'remote', other: 'new' }, enabled: true })).toEqual({
    prompts: { other: 'new' },
    enabled: false,
  })
})
