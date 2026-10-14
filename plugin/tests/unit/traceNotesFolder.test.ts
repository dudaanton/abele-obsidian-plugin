import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { App } from 'obsidian'
import {
  isAbsoluteFolder,
  notesFolder,
  NotesFolderUnavailable,
  saveRunNote,
} from '@/debugger/trace/notesFolder'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A vault that only creates notes and folders, on a desktop or a phone adapter. */
function fakeApp(adapter: Record<string, unknown>) {
  const files = new Map<string, string>()
  const folders = new Set<string>()
  const app = {
    vault: {
      adapter,
      getAbstractFileByPath: (p: string) => (files.has(p) || folders.has(p) ? { path: p } : null),
      createFolder: async (p: string) => void folders.add(p),
      create: async (p: string, text: string) => {
        files.set(p, text)
        return { path: p }
      },
    },
  }
  return { app: app as unknown as App, files, folders }
}

describe('the folder for notes about recorded runs', () => {
  it('reads a vault path, an absolute path, and an absolute path inside the vault', () => {
    expect(isAbsoluteFolder('Trace')).toBe(false)
    expect(isAbsoluteFolder('/srv/notes')).toBe(true)
    expect(isAbsoluteFolder('C:\\notes')).toBe(true)
    expect(notesFolder('')).toEqual({ kind: 'vault', path: 'Trace' })
    expect(notesFolder('Work/Runs/')).toEqual({ kind: 'vault', path: 'Work/Runs' })
    expect(notesFolder('/srv/notes/', '/home/sample/vault')).toEqual({
      kind: 'outside',
      path: '/srv/notes',
    })
    expect(notesFolder('/home/sample/vault/Runs', '/home/sample/vault')).toEqual({
      kind: 'vault',
      path: 'Runs',
    })
    expect(notesFolder('/home/sample/vault', '/home/sample/vault/')).toEqual({
      kind: 'vault',
      path: '',
    })
    expect(notesFolder('/home/sample/vault-other', '/home/sample/vault')).toEqual({
      kind: 'outside',
      path: '/home/sample/vault-other',
    })
  })

  it('writes into a vault folder, making it, and never over a note already there', async () => {
    const v = fakeApp({})
    expect(await saveRunNote(v.app, 'Runs', 'Sample run', 'one')).toEqual({
      path: 'Runs/Sample run.md',
      outside: false,
    })
    expect(v.folders.has('Runs')).toBe(true)
    expect((await saveRunNote(v.app, 'Runs', 'Sample run', 'two')).path).toBe(
      'Runs/Sample run 2.md'
    )
    expect(v.files.get('Runs/Sample run.md')).toBe('one')
  })

  it('writes into a folder of the computer outside the vault, never over a note there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trace-notes-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'Sample run.md'), 'kept')
    const v = fakeApp({ getBasePath: () => '/elsewhere/vault', fsPromises: fsp })
    const r = await saveRunNote(v.app, dir, 'Sample run', 'note text')
    expect(r).toEqual({ path: join(dir, 'Sample run 2.md'), outside: true })
    expect(readFileSync(join(dir, 'Sample run.md'), 'utf8')).toBe('kept')
    expect(readFileSync(r.path, 'utf8')).toBe('note text')
    expect(v.files.size).toBe(0)
  })

  it('says the folder is not on this device instead of writing anywhere else', async () => {
    const v = fakeApp({ getBasePath: () => '/elsewhere/vault', fsPromises: fsp })
    const missing = join(tmpdir(), 'trace-notes-missing-sample', 'Runs')
    const write = saveRunNote(v.app, missing, 'Sample run', 'x')
    await expect(write).rejects.toBeInstanceOf(NotesFolderUnavailable)
    await expect(write).rejects.toThrow(/is not on this device.*Settings → Nodes/)
    expect(v.files.size).toBe(0)
    expect(v.folders.size).toBe(0)
  })

  it('on a phone, says it cannot write outside the vault', async () => {
    const v = fakeApp({})
    await expect(saveRunNote(v.app, '/srv/notes', 'Sample run', 'x')).rejects.toThrow(
      /outside the vault, and this device cannot write there/
    )
    expect(v.files.size).toBe(0)
  })
})
