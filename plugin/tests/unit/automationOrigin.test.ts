/**
 * Telling a change made on this device from one that arrived.
 *
 * Obsidian raises the same `modify` for a note saved here and for one Obsidian Sync or
 * Syncthing rewrote on disk. What differs is the road: everything written here goes through
 * the vault's own methods, and a file changed underneath Obsidian does not. So the vault's
 * write methods are wrapped to mark the path, and a change nobody marked came from elsewhere.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TFile } from 'obsidian'
import { LocalWrites } from '@/automations/LocalWrites'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'

let app: FakeApp
let writes: LocalWrites
let uninstall: () => void

beforeEach(() => {
  vi.useFakeTimers()
  app = buildFakeVault([{ path: 'Notes/a.md', frontmatter: { type: 'note' } }])
  writes = new LocalWrites(5000)
  uninstall = writes.install(app as never)
})

afterEach(() => {
  uninstall()
  vi.useRealTimers()
})

const vault = () => app.vault as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
const a = () => app.vault.getAbstractFileByPath('Notes/a.md') as TFile

describe('a change made here', () => {
  it('through modify, process, append and create is local', async () => {
    await vault().modify(a(), 'x')
    expect(writes.originOf('Notes/a.md').origin).toBe('local')

    await vault().create('Notes/b.md', 'y')
    expect(writes.originOf('Notes/b.md').origin).toBe('local')
  })

  it('stays local only for the window after the write', async () => {
    await vault().process(a(), (s: string) => s + '!')
    vi.advanceTimersByTime(6000)

    expect(writes.originOf('Notes/a.md').origin).toBe('external')
  })

  it('still reaches the vault, with what the method returns', async () => {
    const file = await vault().create('Notes/c.md', 'body')

    expect((file as TFile).path).toBe('Notes/c.md')
    expect(await app.vault.read(file as TFile)).toBe('body')
  })
})

describe('a change nobody here made', () => {
  it('is external', () => {
    expect(writes.originOf('Notes/a.md').origin).toBe('external')
  })
})

describe('the automations behind a write', () => {
  it('are kept against the path, for the window', () => {
    writes.markChain('Notes/a.md', ['r1'])
    writes.markChain('Notes/a.md', ['r1', 'r2'])

    expect(writes.originOf('Notes/a.md')).toEqual({ origin: 'local', chain: ['r1', 'r2'] })
    vi.advanceTimersByTime(6000)
    expect(writes.originOf('Notes/a.md').chain).toEqual([])
  })
})

describe('uninstalled', () => {
  it('puts the vault methods back', () => {
    const wrapped = vault().modify
    uninstall()

    expect(vault().modify).not.toBe(wrapped)
    uninstall = () => {}
  })

  it('leaves a later wrapper in place, and stops marking', async () => {
    const ours = vault().modify
    const theirs = (...args: unknown[]) => ours(...args)
    vault().modify = theirs
    uninstall()
    uninstall = () => {}

    expect(vault().modify).toBe(theirs)
    await vault().modify(a(), 'z')
    expect(writes.originOf('Notes/a.md').origin).toBe('external')
  })
})
