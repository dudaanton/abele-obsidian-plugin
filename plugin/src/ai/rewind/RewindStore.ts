/**
 * Where a chat's rewind log is kept: in the plugin's folder, on this device only.
 *
 * `<configDir>/plugins/abele/rewind/<chat>/log.json` holds the entries, with the text of every
 * file as it was before; binaries sit beside it as `<hash>.bin`. None of it is in the chat file,
 * so a chat opened on another device has its conversation and nothing to rewind with — the
 * snapshots can be large, and the vault is what gets synced.
 */
import type { App, DataAdapter } from 'obsidian'
import type { RewindLogFile } from './types'

export interface ChatUsage {
  key: string
  bytes: number
  /** When its log was last written. */
  touched: number
}

export interface RewindStore {
  readLog(key: string): Promise<RewindLogFile | null>
  writeLog(key: string, log: RewindLogFile): Promise<void>
  readBlob(key: string, name: string): Promise<ArrayBuffer | null>
  writeBlob(key: string, name: string, data: ArrayBuffer): Promise<void>
  removeBlob(key: string, name: string): Promise<void>
  /** Every chat with a log, and what it takes. */
  usage(): Promise<ChatUsage[]>
  /** Forgets a chat's log and copies. */
  drop(key: string): Promise<void>
}

type Adapter = DataAdapter & {
  readBinary(path: string): Promise<ArrayBuffer>
  writeBinary(path: string, data: ArrayBuffer): Promise<void>
}

export function rewindDir(app: App): string {
  return `${app.vault.configDir}/plugins/abele/rewind`
}

/** The store over Obsidian's adapter. */
export function adapterStore(app: App): RewindStore {
  const adapter = app.vault.adapter as Adapter
  const root = rewindDir(app)
  const dir = (key: string) => `${root}/${key}`
  const ensure = async (key: string) => {
    for (const path of [`${app.vault.configDir}/plugins/abele`, root, dir(key)]) {
      if (!(await adapter.exists(path))) await adapter.mkdir(path)
    }
  }

  return {
    async readLog(key) {
      const path = `${dir(key)}/log.json`
      if (!(await adapter.exists(path))) return null
      try {
        const parsed = JSON.parse(await adapter.read(path)) as RewindLogFile
        return parsed?.version === 1 && Array.isArray(parsed.entries) ? parsed : null
      } catch (err) {
        console.warn('[Abele] Rewind log unreadable, starting a new one', key, err)
        return null
      }
    },
    async writeLog(key, log) {
      await ensure(key)
      await adapter.write(`${dir(key)}/log.json`, JSON.stringify(log))
    },
    async readBlob(key, name) {
      const path = `${dir(key)}/${name}.bin`
      if (!(await adapter.exists(path))) return null
      return adapter.readBinary(path)
    },
    async writeBlob(key, name, data) {
      await ensure(key)
      const path = `${dir(key)}/${name}.bin`
      if (!(await adapter.exists(path))) await adapter.writeBinary(path, data)
    },
    async removeBlob(key, name) {
      const path = `${dir(key)}/${name}.bin`
      if (await adapter.exists(path)) await adapter.remove(path)
    },
    async usage() {
      if (!(await adapter.exists(root))) return []
      const { folders } = await adapter.list(root)
      const out: ChatUsage[] = []
      for (const folder of folders) {
        const { files } = await adapter.list(folder)
        let bytes = 0
        let touched = 0
        for (const file of files) {
          const stat = await adapter.stat(file)
          bytes += stat?.size ?? 0
          if (file.endsWith('/log.json')) touched = stat?.mtime ?? 0
        }
        out.push({ key: folder.slice(folder.lastIndexOf('/') + 1), bytes, touched })
      }
      return out
    },
    async drop(key) {
      if (await adapter.exists(dir(key))) await adapter.rmdir(dir(key), true)
    },
  }
}

/** A store in memory, for tests and for a chat whose log could not be written. */
export function memoryStore(): RewindStore & { blobs: Map<string, ArrayBuffer> } {
  const logs = new Map<string, { log: string; touched: number }>()
  const blobs = new Map<string, ArrayBuffer>()
  let clock = 0
  return {
    blobs,
    async readLog(key) {
      const kept = logs.get(key)
      return kept ? (JSON.parse(kept.log) as RewindLogFile) : null
    },
    async writeLog(key, log) {
      logs.set(key, { log: JSON.stringify(log), touched: ++clock })
    },
    async readBlob(key, name) {
      return blobs.get(`${key}/${name}`) ?? null
    },
    async writeBlob(key, name, data) {
      blobs.set(`${key}/${name}`, data)
    },
    async removeBlob(key, name) {
      blobs.delete(`${key}/${name}`)
    },
    async usage() {
      return [...logs].map(([key, kept]) => {
        let bytes = kept.log.length
        for (const [name, data] of blobs) if (name.startsWith(`${key}/`)) bytes += data.byteLength
        return { key, bytes, touched: kept.touched }
      })
    },
    async drop(key) {
      logs.delete(key)
      for (const name of [...blobs.keys()]) if (name.startsWith(`${key}/`)) blobs.delete(name)
    },
  }
}
