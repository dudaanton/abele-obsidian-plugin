import { expect, it } from 'vitest'
import { SectionSettings } from '@/sync/abeleSectionEngine'
import type { AbeleSettings } from '@/services/AbeleConfig'

it('refuses corrupt device policy rather than sharing previously private sections', () => {
  expect(
    () => new SectionSettings({ read: () => ({ v: 1, chosen: 'damaged' }), write: () => {} })
  ).toThrow('section')
})

const settings = (theme: string, agents: unknown[] = []) =>
  ({ reader: { theme }, ai: { agents }, refreshDelay: 10 }) as unknown as AbeleSettings
function fixture() {
  let saved: unknown
  const storage = {
    read: () => saved,
    write: (value: unknown) => {
      saved = structuredClone(value)
    },
  }
  return { storage, engine: new SectionSettings(storage) }
}
it('resumes sending the chosen device version after interruption before the settings write', () => {
  const { storage, engine } = fixture()
  engine.receive(settings('shared'))
  engine.choose('reader', false, settings('private'))
  engine.choose('reader', true, settings('private'), 'device')
  const restarted = new SectionSettings(storage)
  expect(restarted.receive(settings('shared')).reader).toEqual({ theme: 'private' })
  expect(restarted.project(settings('private')).reader).toEqual({ theme: 'private' })
})
it('keeps a pending choice as recovery when another device changes the section before restart', () => {
  const { storage, engine } = fixture()
  engine.receive(settings('shared'))
  engine.choose('reader', false, settings('private'))
  engine.choose('reader', true, settings('private'), 'device')
  const restarted = new SectionSettings(storage)
  const incoming = restarted.receive(settings('new-shared'))
  expect(incoming.reader).toEqual({ theme: 'new-shared' })
  expect(restarted.restore('reader', incoming).reader).toEqual({ theme: 'private' })
})
it('keeps device choices and unticked values outside the shared settings across restart', () => {
  const { storage, engine } = fixture()
  const mine = settings('local')
  engine.receive(mine)
  engine.choose('reader', false, mine)
  const wire = engine.project(settings('private'))
  expect(wire.reader).toEqual(mine.reader)
  expect(JSON.stringify(wire)).not.toContain('private')
  const restarted = new SectionSettings(storage)
  expect(restarted.receive(settings('remote')).reader).toEqual({ theme: 'private' })
  expect(restarted.chosen.has('reader')).toBe(false)
})
it('takes the incoming section after offline edits and durably keeps the local version for restore', () => {
  const { storage, engine } = fixture()
  engine.receive(settings('base'))
  engine.project(settings('offline'))
  const incoming = engine.receive(settings('other'), settings('offline'), 'Sample tablet')
  expect(incoming.reader).toEqual({ theme: 'other' })
  const restarted = new SectionSettings(storage)
  expect(restarted.kept).toMatchObject([{ id: 'reader', from: 'Sample tablet' }])
  expect(restarted.restore('reader', incoming).reader).toEqual({ theme: 'offline' })
})
it('does not flag a remote-only change as an offline conflict', () => {
  const { engine } = fixture()
  engine.receive(settings('base'))
  expect(engine.receive(settings('other'), settings('base')).reader).toEqual({ theme: 'other' })
  expect(engine.kept).toEqual([])
})
it('requires a choice for a differing section and keeps the alternative when taking the vault copy', () => {
  const { engine } = fixture()
  engine.receive(settings('base'))
  engine.choose('reader', false, settings('local'))
  const mine = engine.receive(settings('vault'), settings('local'))
  expect(engine.differs('reader', mine)).toBe(true)
  expect(() => engine.choose('reader', true, mine)).toThrow()
  expect(engine.choose('reader', true, mine, 'vault').reader).toEqual({ theme: 'vault' })
  expect(engine.restore('reader', settings('vault')).reader).toEqual({ theme: 'local' })
})
it('replaces lists as sections, including empty lists, and never exposes sync connections', () => {
  const { engine } = fixture()
  const initial = settings('base', [{ id: 'sample-agent' }])
  engine.receive(initial)
  expect(engine.receive(settings('base'), initial).ai.agents).toEqual([])
  expect(engine.ids).not.toContain('connection')
  expect(engine.ids).not.toContain('sync')
  expect(engine.ids).not.toContain('script-files')
})
it('keeps a local section edit when only another section changed remotely', () => {
  const { engine } = fixture()
  engine.receive(settings('base'))
  const incoming = settings('base', [{ id: 'remote-agent' }])
  expect(engine.receive(incoming, settings('pending')).reader).toEqual({ theme: 'pending' })
})
it('retains successive local conflict copies until each restore is saved', () => {
  const { engine } = fixture()
  engine.receive(settings('base'))
  engine.receive(settings('remote-one'), settings('local-one'))
  engine.receive(settings('remote-two'), settings('local-two'))
  expect(engine.restore('reader', settings('remote-two')).reader).toEqual({ theme: 'local-two' })
  engine.restored('reader')
  expect(engine.restore('reader', settings('remote-two')).reader).toEqual({ theme: 'local-one' })
})
it('keeps the vault alternative when explicitly sending this device version', () => {
  let saved: unknown
  const engine = new SectionSettings(
    {
      read: () => saved,
      write: (value) => {
        saved = value
      },
    },
    'Sample computer'
  )
  engine.receive(settings('base'))
  engine.choose('reader', false, settings('device'))
  const own = engine.receive(settings('vault'), settings('device'))
  const selected = engine.choose('reader', true, own, 'device')
  expect(selected.reader).toEqual({ theme: 'device' })
  expect(engine.kept[0].from).toBe('Sample computer')
  expect(engine.restore('reader', selected).reader).toEqual({ theme: 'vault' })
})
