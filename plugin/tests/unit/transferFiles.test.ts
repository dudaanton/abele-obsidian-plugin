/**
 * Carrying the scripts, skills and prompts themselves, not just the settings that point at them.
 *
 * A settings transfer that names a scripts folder and leaves the scripts behind is a transfer
 * of nothing: the other device gets a folder path with no scripts in it. These three live in
 * the vault as files, so they travel as files — and land as files, in the folder the receiving
 * vault uses rather than the one the sender happened to have.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { collectFiles, applyFiles, planFiles, readCurrent, targetPath } from '@/transfer/files'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'
import type { TransferEntry, TransferFile } from '@/transfer/types'

let app: FakeApp

const SCRIPT = 'const run = () => 42\n'

const vault = () =>
  useVault([
    { path: 'Scripts/tally.js', content: SCRIPT },
    { path: 'Scripts/report.js', content: 'export const report = 1\n' },
    {
      path: 'Notes/Writing.md',
      frontmatter: { type: 'abele-skill', name: 'writing', description: 'How to write' },
      content: 'Write plainly.',
    },
    {
      path: 'Notes/Standup.md',
      frontmatter: { type: 'abele-prompt', description: 'Daily standup' },
      content: 'What did you do?',
    },
    { path: 'Notes/Ordinary.md', content: 'Nothing special.' },
  ])

beforeEach(() => {
  app = vault()
})

const fileOf = (entries: TransferEntry[], id: string) =>
  entries.find((entry) => entry.id === id)?.data as TransferFile | undefined

describe('gathering what lives in the vault', () => {
  it('takes the scripts out of the folder they are configured in', async () => {
    const entries = await collectFiles(app as never, 'Scripts')

    expect(
      entries
        .filter((e) => e.section === 'script-files')
        .map((e) => e.label)
        .sort()
    ).toEqual(['report.js', 'tally.js'])
  })

  it('carries what a script actually says', async () => {
    const entries = await collectFiles(app as never, 'Scripts')

    expect(fileOf(entries, 'Scripts/tally.js')?.content).toBe(SCRIPT)
  })

  /** The receiving vault may keep its scripts elsewhere, so what travels is the name. */
  it('remembers a script by its place inside the scripts folder', async () => {
    const entries = await collectFiles(app as never, 'Scripts')

    expect(fileOf(entries, 'Scripts/tally.js')?.path).toBe('tally.js')
    expect(fileOf(entries, 'Scripts/tally.js')?.base).toBe('Scripts')
  })

  it('finds the skills by what they say they are, wherever they sit', async () => {
    const entries = await collectFiles(app as never, 'Scripts')

    const skill = entries.find((e) => e.section === 'skill-notes')
    expect(skill?.label).toBe('writing')
    expect((skill?.data as TransferFile).path).toBe('Notes/Writing.md')
  })

  it('finds the prompts the same way', async () => {
    const entries = await collectFiles(app as never, 'Scripts')

    expect(entries.filter((e) => e.section === 'prompt-notes').map((e) => e.label)).toEqual([
      'Standup',
    ])
  })

  it('leaves ordinary notes alone', async () => {
    const entries = await collectFiles(app as never, 'Scripts')

    expect(JSON.stringify(entries)).not.toContain('Ordinary')
  })

  it('offers no scripts when no folder is configured', async () => {
    const entries = await collectFiles(app as never, '')

    expect(entries.some((e) => e.section === 'script-files')).toBe(false)
  })
})

describe('where an arriving file lands', () => {
  const entry = (over: Partial<TransferFile> = {}): TransferEntry => ({
    section: 'script-files',
    id: 'Scripts/tally.js',
    label: 'tally.js',
    data: { path: 'tally.js', content: SCRIPT, base: 'Scripts', ...over },
  })

  it('goes into the scripts folder this vault uses, not the one it came from', () => {
    expect(targetPath(entry(), 'Automation')).toBe('Automation/tally.js')
  })

  it('falls back to the folder it came from when this vault has none', () => {
    expect(targetPath(entry(), '')).toBe('Scripts/tally.js')
  })

  it('keeps a skill where it was, because it can live anywhere', () => {
    const skill: TransferEntry = {
      section: 'skill-notes',
      id: 'Notes/Writing.md',
      label: 'writing',
      data: { path: 'Notes/Writing.md', content: 'Write plainly.' },
    }

    expect(targetPath(skill, 'Automation')).toBe('Notes/Writing.md')
  })
})

describe('what the receiving side is told', () => {
  it('calls a file this vault does not have new', async () => {
    const arriving = await collectFiles(app as never, 'Scripts')
    const empty = useVault([])

    const planned = planFiles(arriving, await readCurrent(empty as never, arriving, 'Scripts'), 'Scripts')

    expect(planned.every((item) => item.status === 'new')).toBe(true)
  })

  it('says an identical file would change nothing', async () => {
    const arriving = await collectFiles(app as never, 'Scripts')

    const planned = planFiles(arriving, await readCurrent(app as never, arriving, 'Scripts'), 'Scripts')

    expect(planned.every((item) => item.status === 'same')).toBe(true)
  })

  it('calls a file whose contents differ a replacement', async () => {
    const arriving = await collectFiles(app as never, 'Scripts')
    const changed = useVault([{ path: 'Scripts/tally.js', content: 'const run = () => 0\n' }])

    const planned = planFiles(arriving, await readCurrent(changed as never, arriving, 'Scripts'), 'Scripts')

    expect(planned.find((i) => i.entry.id === 'Scripts/tally.js')?.status).toBe('replace')
  })
})

describe('writing what arrived', () => {
  it('creates a file the vault did not have', async () => {
    const arriving = await collectFiles(app as never, 'Scripts')
    const empty = useVault([])

    const result = await applyFiles(empty as never, arriving, 'Scripts')

    expect(result.written).toBe(arriving.length)
    expect(await empty.vault.read(empty.vault.getFileByPath('Scripts/tally.js')!)).toBe(SCRIPT)
  })

  it('overwrites one it already had rather than making a second', async () => {
    const arriving = await collectFiles(app as never, 'Scripts')
    const other = useVault([{ path: 'Scripts/tally.js', content: 'old' }])

    await applyFiles(other as never, arriving, 'Scripts')

    expect(other.vault.getFiles().filter((f) => f.path === 'Scripts/tally.js')).toHaveLength(1)
    expect(await other.vault.read(other.vault.getFileByPath('Scripts/tally.js')!)).toBe(SCRIPT)
  })

  it('makes the folder when the vault has no such place yet', async () => {
    const arriving = (await collectFiles(app as never, 'Scripts')).filter(
      (e) => e.section === 'script-files'
    )
    const empty = useVault([])

    await applyFiles(empty as never, arriving, 'Automation/Deep')

    expect(empty.vault.getFileByPath('Automation/Deep/tally.js')).toBeTruthy()
  })

  /** One file the vault refuses must not cost the others their turn. */
  it('keeps going when one file cannot be written', async () => {
    const arriving = await collectFiles(app as never, 'Scripts')
    const empty = useVault([])
    const create = empty.vault.create.bind(empty.vault)
    empty.vault.create = async (path: string, content: string) => {
      if (path.endsWith('tally.js')) throw new Error('nope')
      return create(path, content)
    }

    const result = await applyFiles(empty as never, arriving, 'Scripts')

    expect(result.failed).toEqual(['Scripts/tally.js'])
    expect(result.written).toBe(arriving.length - 1)
  })
})
