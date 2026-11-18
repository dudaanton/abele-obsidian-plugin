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
it('retains the chosen private version when an earlier shared version returns after restart', () => {
  const { storage, engine } = fixture()
  engine.receive(settings('initial'))
  engine.written(engine.project(settings('saved')))
  engine.choose('reader', false, settings('saved'))
  engine.written(engine.project(settings('private')))
  engine.choose('reader', true, settings('private'), 'device')
  const restarted = new SectionSettings(storage)
  const incoming = restarted.receive(settings('initial'))
  expect(incoming.reader).toEqual({ theme: 'initial' })
  expect(restarted.restore('reader', incoming).reader).toEqual({ theme: 'private' })
})

const orderings = [
  {
    name: 'save prepared',
    steps: ['edit-saved', 'prepare'],
    local: 'saved',
    shared: 'initial',
    on: true,
  },
  {
    name: 'save completed',
    steps: ['edit-saved', 'save'],
    local: 'saved',
    shared: 'saved',
    on: true,
  },
  {
    name: 'unticked',
    steps: ['edit-saved', 'save', 'off'],
    local: 'saved',
    shared: 'saved',
    on: false,
  },
  {
    name: 'private save prepared',
    steps: ['edit-saved', 'save', 'off', 'edit-private', 'prepare'],
    local: 'private',
    shared: 'saved',
    on: false,
  },
  {
    name: 'private save completed',
    steps: ['edit-saved', 'save', 'off', 'edit-private', 'save'],
    local: 'private',
    shared: 'saved',
    on: false,
  },
  {
    name: 'device chosen',
    steps: ['edit-saved', 'save', 'off', 'edit-private', 'save', 'device'],
    local: 'private',
    shared: 'saved',
    on: true,
  },
  {
    name: 'device write prepared',
    steps: ['edit-saved', 'save', 'off', 'edit-private', 'save', 'device', 'prepare'],
    local: 'private',
    shared: 'saved',
    on: true,
  },
  {
    name: 'device write unacknowledged',
    steps: ['edit-saved', 'save', 'off', 'edit-private', 'save', 'device', 'write-unacknowledged'],
    local: 'private',
    shared: 'saved',
    on: true,
  },
  {
    name: 'device write completed',
    steps: ['edit-saved', 'save', 'off', 'edit-private', 'save', 'device', 'save'],
    local: 'private',
    shared: 'private',
    on: true,
  },
  {
    name: 'vault chosen',
    steps: ['edit-saved', 'save', 'off', 'edit-private', 'save', 'vault'],
    local: 'saved',
    shared: 'saved',
    on: true,
  },
  {
    name: 'vault write completed',
    steps: ['edit-saved', 'save', 'off', 'edit-private', 'save', 'vault', 'save'],
    local: 'saved',
    shared: 'saved',
    on: true,
  },
  {
    name: 'restore chosen',
    steps: ['edit-saved', 'save', 'off', 'edit-private', 'save', 'vault', 'restore'],
    local: 'private',
    shared: 'saved',
    on: true,
  },
  {
    name: 'pending choice unticked again',
    steps: ['edit-saved', 'save', 'off', 'edit-private', 'save', 'device', 'off'],
    local: 'private',
    shared: 'saved',
    on: false,
  },
  {
    name: 'device choice equals incoming ancestor',
    steps: ['edit-saved', 'save', 'off', 'edit-initial', 'save', 'device'],
    local: 'initial',
    shared: 'saved',
    on: true,
  },
  {
    name: 'older version received while private',
    steps: ['edit-saved', 'save', 'off', 'edit-private', 'save', 'receive-initial'],
    local: 'private',
    shared: 'initial',
    on: false,
  },
  {
    name: 'device chosen after older incoming version',
    steps: ['edit-saved', 'save', 'off', 'edit-private', 'save', 'receive-initial', 'device'],
    local: 'private',
    shared: 'initial',
    on: true,
  },
] as const

it.each(
  orderings.flatMap((ordering) =>
    [false, true].flatMap((restart) =>
      ['initial', 'saved', 'private', 'incoming'].map((incoming) => ({
        ...ordering,
        restart,
        incoming,
      }))
    )
  )
)(
  '$name, restart=$restart, receive=$incoming preserves local intent or a recovery copy',
  ({ steps, local, shared, on, restart, incoming }) => {
    const fixtureState = fixture()
    let engine = fixtureState.engine
    let current = engine.receive(settings('initial'))
    let disk = current
    for (const step of steps) {
      switch (step) {
        case 'edit-saved':
          current = settings('saved')
          break
        case 'edit-initial':
          current = settings('initial')
          break
        case 'edit-private':
          current = settings('private')
          break
        case 'prepare':
          engine.project(current)
          break
        case 'write-unacknowledged':
          disk = engine.project(current)
          break
        case 'save':
          disk = engine.project(current)
          engine.written(disk)
          break
        case 'off':
          current = engine.choose('reader', false, current)
          break
        case 'device':
          current = engine.choose('reader', true, current, 'device')
          break
        case 'vault':
          current = engine.choose('reader', true, current, 'vault')
          break
        case 'restore':
          current = engine.restore('reader', current)
          break
        case 'receive-initial':
          disk = settings('initial')
          current = engine.receive(disk, current)
          break
      }
    }
    // An unacknowledged disk write is observable only through the next read, never as a
    // successful engine transition. The incoming file may replace it before that read.
    expect(disk.reader).toEqual({
      theme: steps.some((step) => step === 'write-unacknowledged') ? 'private' : shared,
    })
    if (restart) engine = new SectionSettings(fixtureState.storage)
    const result = engine.receive(settings(incoming), restart ? undefined : current)
    expect(result.reader).toEqual({ theme: !on || incoming === shared ? local : incoming })
    const recoverable = [result.reader]
    while (engine.kept.length) {
      recoverable.push(engine.restore('reader', result).reader)
      engine.restored('reader')
    }
    expect(recoverable).toContainEqual({ theme: local })
    if (steps.some((step) => step === 'edit-private'))
      expect(recoverable).toContainEqual({ theme: 'private' })
  }
)
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
