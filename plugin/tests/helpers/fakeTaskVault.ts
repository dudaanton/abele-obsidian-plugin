/**
 * A vault of task notes that renames the way Obsidian does: the file system underneath is
 * case-insensitive, as on macOS and Windows, and `fileManager.renameFile` rewrites every
 * wikilink to the old name — the renamed note's own links included — before it resolves.
 * `onModify` stands for the vault's modify event, which that rewrite fires.
 */
import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

export interface FakeTaskVault {
  app: any
  file(path: string): TFile | null
  content(path: string): string
  paths(): string[]
  write(path: string, content: string): void
  renames: Array<[string, string]>
  onModify: ((file: TFile) => Promise<void>) | null
}

function makeFile(path: string): TFile {
  const file = new TFile()
  setPath(file, path)
  return file
}

function setPath(file: TFile, path: string): void {
  const name = path.split('/').pop() ?? path
  file.path = path
  file.name = name
  file.extension = 'md'
  file.basename = name.replace(/\.md$/, '')
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildFakeTaskVault(notes: Record<string, string>): FakeTaskVault {
  const files = new Map<string, TFile>()
  const contents = new Map<TFile, string>()
  for (const [path, content] of Object.entries(notes)) {
    const file = makeFile(path)
    files.set(path, file)
    contents.set(file, content)
  }

  const vault: FakeTaskVault = {
    app: null,
    file: (path) => files.get(path) ?? null,
    content: (path) => contents.get(files.get(path)!) ?? '',
    paths: () => [...files.keys()],
    write: (path, content) => void contents.set(files.get(path)!, content),
    renames: [],
    onModify: null,
  }

  const frontmatterOf = (content: string): Record<string, unknown> | undefined => {
    const match = /^---\n([\s\S]*?)\n---/.exec(content)
    if (!match) return undefined
    const fm: Record<string, unknown> = {}
    for (const line of match[1].split('\n')) {
      const [key, ...rest] = line.split(':')
      fm[key.trim()] = rest.join(':').trim()
    }
    return fm
  }

  vault.app = {
    vault: {
      adapter: {
        exists: async (path: string) =>
          [...files.keys()].some((p) => p.toLowerCase() === path.toLowerCase()),
      },
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getFileByPath: (path: string) => files.get(path) ?? null,
      read: async (file: TFile) => contents.get(file) ?? '',
      cachedRead: async (file: TFile) => contents.get(file) ?? '',
    },
    workspace: { getLeavesOfType: () => [] },
    metadataCache: {
      getFileCache: (file: TFile) => ({ frontmatter: frontmatterOf(contents.get(file) ?? '') }),
      getFirstLinkpathDest: (linkpath: string) => {
        const wanted = linkpath.replace(/\.md$/, '').toLowerCase()
        for (const file of files.values()) {
          if (file.path.replace(/\.md$/, '').toLowerCase() === wanted) return file
        }
        for (const file of files.values()) {
          if (file.basename.toLowerCase() === wanted) return file
        }
        return null
      },
    },
    fileManager: {
      renameFile: async (file: TFile, newPath: string) => {
        const oldPath = file.path
        const oldName = file.basename
        const clash = files.get(newPath)
        if (clash && clash !== file) throw new Error('Destination file already exists!')
        files.delete(oldPath)
        setPath(file, newPath)
        files.set(newPath, file)
        vault.renames.push([oldPath, newPath])

        const link = new RegExp(`\\[\\[${escape(oldName)}(\\|[^\\]]*)?\\]\\]`, 'gi')
        for (const [other, content] of contents) {
          const updated = content.replace(
            link,
            (_m, alias?: string) => `[[${file.basename}${alias ?? ''}]]`
          )
          if (updated === content) continue
          contents.set(other, updated)
          await vault.onModify?.(other)
        }
      },
    },
  }
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = vault.app
  return vault
}

/** What typing into a task note does: the text changes, then the modify event fires. */
export async function editNote(vault: FakeTaskVault, path: string, content: string) {
  const file = vault.file(path)!
  vault.write(path, content)
  await vault.onModify?.(file)
}
