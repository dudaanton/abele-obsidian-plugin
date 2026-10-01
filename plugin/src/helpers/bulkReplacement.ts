import { parseYaml, stringifyYaml, TFile, type App } from 'obsidian'
import { getEditorForFile } from './vaultUtils'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

export interface ReplacementPreview {
  oldPath: string
  newPath: string
  oldFrontmatter: Record<string, any>
  newFrontmatter: Record<string, any>
  oldRaw: string
  newRaw: string
  oldContent: string | null
  newContent: string | null
  sourceText: string
  sourceMtime: number
  error?: string
  applying?: boolean
}

/** Preview properties and body must come from the same read, not a delayed metadata cache. */
export function replacementFrontmatter(text: string): Record<string, any> {
  const match = FRONTMATTER.exec(text)
  const parsed = match ? parseYaml(match[1]) : null
  if (parsed != null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new Error('Frontmatter must be a property map.')
  }
  return parsed ?? {}
}

function replacementText(result: ReplacementPreview): string {
  const body = result.newContent ?? result.sourceText.replace(FRONTMATTER, '')
  if (JSON.stringify(result.oldFrontmatter) === JSON.stringify(result.newFrontmatter)) {
    const head = FRONTMATTER.exec(result.sourceText)?.[0] ?? ''
    return head + body
  }
  const properties = result.newFrontmatter ?? {}
  const head = Object.keys(properties).length
    ? `---\n${stringifyYaml(properties).trimEnd()}\n---\n`
    : ''
  return head + body
}

/** One awaited compare-and-write for properties and body, followed by an awaited rename. */
export async function applyReplacementPreview(app: App, result: ReplacementPreview): Promise<void> {
  if (result.applying) return
  result.applying = true
  result.error = undefined
  try {
    const file = app.vault.getAbstractFileByPath(result.oldPath)
    if (!(file instanceof TFile)) throw new Error('Note no longer exists. Preview again.')
    const editor = getEditorForFile(file)
    const assertUnchanged = (current: string, expected: string, mtime: number) => {
      if (
        current !== expected ||
        file.stat.mtime !== mtime ||
        (editor && editor.getValue() !== expected)
      ) {
        throw new Error('Note changed after preview. Preview again before replacing.')
      }
    }
    // Check rename collisions before writing the note, as well as letting Obsidian enforce
    // them at rename time. Do not leave half of a known-impossible operation applied.
    if (result.newPath !== result.oldPath && app.vault.getAbstractFileByPath(result.newPath)) {
      throw new Error('Destination already exists. Preview again with a different path.')
    }
    const next = replacementText(result)
    if (next === result.sourceText) {
      assertUnchanged(await app.vault.read(file), result.sourceText, result.sourceMtime)
    } else {
      await app.vault.process(file, (current) => {
        assertUnchanged(current, result.sourceText, result.sourceMtime)
        return next
      })
    }
    // Do not push a stale value into an editor after an await. Obsidian propagates the vault
    // change; setValue here used to erase typing made while the write was in flight.
    result.sourceText = next
    result.sourceMtime = file.stat.mtime
    if (result.oldPath !== result.newPath) {
      if ((await app.vault.read(file)) !== next)
        throw new Error('Note changed before rename. Preview again.')
      await app.fileManager.renameFile(file, result.newPath)
    }
    result.oldFrontmatter = result.newFrontmatter
    result.oldContent = result.newContent
    result.oldPath = result.newPath
    result.oldRaw = result.newRaw
  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : String(err)
  } finally {
    result.applying = false
  }
}
