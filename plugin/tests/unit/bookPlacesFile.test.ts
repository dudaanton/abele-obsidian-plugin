/**
 * The places of books kept in a file in the vault (`src/reader/places.ts`): where each copy is,
 * the file heard when it changes on disk, and the places moved when the path is set anew.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TFile, Notice } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_READER_SETTINGS } from '@/reader/settings'
import {
  followPlace,
  initBookPlaces,
  MOVE_AFTER_MS,
  placeFiles,
  type PlacesAdapter,
} from '@/reader/places'

const DIR = '.obsidian/plugins/abele'
const place = (cfi: string, at: number, path = 'a.epub') => ({ cfi, fraction: 0.5, path, at })

/** A vault's files as a map, with the folders made along the way. */
function disk(files: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(files).map(([k, v]) => [k, JSON.stringify(v)]))
  const folders = new Set<string>()
  const adapter: PlacesAdapter = {
    exists: async (p) => data.has(p) || folders.has(p),
    read: async (p) => data.get(p) ?? '',
    write: async (p, d) => void data.set(p, d),
    mkdir: async (p) => void folders.add(p),
    remove: async (p) => void data.delete(p),
  }
  const json = (p: string) => (data.has(p) ? JSON.parse(data.get(p)!) : null)
  return { data, folders, adapter, json }
}

describe('where the copies are', () => {
  it('the file in the vault, the backup and the copy from before in the plugin’s folder', async () => {
    const d = disk({ [`${DIR}/book-places.json`]: { 'id:a': place('old', 1) } })
    const files = placeFiles(d.adapter, DIR, 'Books/Reading/places.json')
    expect(await files.legacy!()).toEqual([JSON.stringify({ 'id:a': place('old', 1) })])
    await files.write('{"x":1}', 'backup')
    await files.write('{"x":2}', 'main')
    expect(d.data.get(`${DIR}/book-places.backup.json`)).toBe('{"x":1}')
    expect(d.data.get('Books/Reading/places.json')).toBe('{"x":2}')
    expect(d.folders.has('Books/Reading')).toBe(true)
    await files.dropLegacy!()
    expect(d.data.has(`${DIR}/book-places.json`)).toBe(false)
    // The backup stays: it is this device's own.
    expect(d.data.has(`${DIR}/book-places.backup.json`)).toBe(true)
  })
})

describe('the file in the vault, as the plugin keeps it', () => {
  const handlers: Record<string, (file: unknown) => void> = {}
  const cleanups: (() => void)[] = []
  const pluginOn = (d: ReturnType<typeof disk>) =>
    ({
      manifest: { dir: DIR },
      app: {
        vault: {
          configDir: '.obsidian',
          adapter: d.adapter,
          on: (name: string, cb: (file: unknown) => void) => {
            handlers[name] = cb
            return { name }
          },
        },
      },
      registerEvent: () => {},
      register: (cb: () => void) => cleanups.push(cb),
    }) as never
  const fileAt = (path: string) => Object.assign(new TFile(), { path })
  const setPath = async (placesPath: string) => {
    const config = AbeleConfig.getInstance()
    config.reader = { ...DEFAULT_READER_SETTINGS, placesPath }
    config.version.value++
    await vi.advanceTimersByTimeAsync(MOVE_AFTER_MS + 50)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    AbeleConfig.getInstance().reader = { ...DEFAULT_READER_SETTINGS }
    Notice.shown.length = 0
  })
  afterEach(() => {
    for (const c of cleanups.splice(0)) c()
    vi.useRealTimers()
  })

  it('folds the plugin folder’s places into the vault’s file at the default path', async () => {
    const d = disk({ [`${DIR}/book-places.json`]: { 'id:a': place('old', 1) } })
    const places = initBookPlaces(pluginOn(d))
    expect((await places.get('id:a'))?.cfi).toBe('old')
    await vi.advanceTimersByTimeAsync(2000)
    expect(d.json('abele-book-places.json')['id:a'].cfi).toBe('old')
    expect(d.data.has(`${DIR}/book-places.json`)).toBe(false)
  })

  it('takes a newer place when the file changes on disk, and no other file’s change', async () => {
    const d = disk({ 'abele-book-places.json': { 'id:a': place('a-1', 1) } })
    const places = initBookPlaces(pluginOn(d))
    await places.get('id:a')
    const moved: string[][] = []
    places.onNewer((keys) => moved.push(keys))
    d.data.set('other.json', JSON.stringify({ 'id:a': place('elsewhere', 99) }))
    handlers.modify(fileAt('other.json'))
    await vi.advanceTimersByTimeAsync(0)
    expect(moved).toEqual([])
    d.data.set('abele-book-places.json', JSON.stringify({ 'id:a': place('a-2', 9) }))
    handlers.modify(fileAt('abele-book-places.json'))
    await vi.advanceTimersByTimeAsync(0)
    expect(moved).toEqual([['id:a']])
    expect((await places.get('id:a'))?.cfi).toBe('a-2')
  })

  it('moves the places to the file set, and removes the old one once they are there', async () => {
    const d = disk({ 'abele-book-places.json': { 'id:a': place('a-1', 1) } })
    const places = initBookPlaces(pluginOn(d))
    await places.get('id:a')
    // Half typed: nothing moves.
    await setPath('Books/pla')
    expect(d.data.has('abele-book-places.json')).toBe(true)
    await setPath('Books/places.json')
    expect(d.json('Books/places.json')['id:a'].cfi).toBe('a-1')
    expect(d.data.has('abele-book-places.json')).toBe(false)
    // The new file is the one heard from now on.
    d.data.set('Books/places.json', JSON.stringify({ 'id:a': place('a-3', 50) }))
    handlers.modify(fileAt('Books/places.json'))
    await vi.advanceTimersByTimeAsync(0)
    expect((await places.get('id:a'))?.cfi).toBe('a-3')
  })

  it('leaves the places where they were when the file set holds something else, and says so', async () => {
    const d = disk({ 'abele-book-places.json': { 'id:a': place('a-1', 1) } })
    d.data.set('notes.json', 'not places at all')
    const places = initBookPlaces(pluginOn(d))
    await places.get('id:a')
    await setPath('notes.json')
    expect(d.data.get('notes.json')).toBe('not places at all')
    expect(d.data.has('abele-book-places.json')).toBe(true)
    expect(Notice.shown.at(-1)).toMatch(/stay in abele-book-places\.json/)
  })

  it('moves an open book on to a newer place from another device, and says so', async () => {
    const d = disk({
      'abele-book-places.json': { 'id:a': place('a-1', 1), 'id:b': place('b-1', 1, 'b.epub') },
    })
    const places = initBookPlaces(pluginOn(d))
    await places.get('id:a')
    let here = 'a-1'
    const go = vi.fn(async (cfi: string) => void (here = cfi))
    const follow = followPlace('id:a', () => here, go)!
    // Another book's place: nothing moves.
    d.data.set('abele-book-places.json', JSON.stringify({ 'id:b': place('b-2', 9, 'b.epub') }))
    handlers.modify(fileAt('abele-book-places.json'))
    await vi.advanceTimersByTimeAsync(0)
    expect(go).not.toHaveBeenCalled()
    d.data.set('abele-book-places.json', JSON.stringify({ 'id:a': place('a-2', 9) }))
    handlers.modify(fileAt('abele-book-places.json'))
    await vi.advanceTimersByTimeAsync(0)
    expect(go).toHaveBeenCalledWith('a-2')
    expect(Notice.shown.at(-1)).toMatch(/another device/)
    // Closed: no longer followed.
    follow.stop()
    d.data.set('abele-book-places.json', JSON.stringify({ 'id:a': place('a-3', 20) }))
    handlers.modify(fileAt('abele-book-places.json'))
    await vi.advanceTimersByTimeAsync(0)
    expect(go).toHaveBeenCalledTimes(1)
  })
})
