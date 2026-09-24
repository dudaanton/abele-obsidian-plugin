/**
 * A vault on disk, loaded into the in-memory fake the tools run against.
 *
 * Frontmatter is parsed the way Obsidian's metadata cache holds it: dates stay strings (the
 * core schema has no timestamps), and the file itself is kept byte for byte for `read`.
 */
import fs from 'fs'
import path from 'path'
import { load } from 'js-yaml'
import { CORE_SCHEMA } from 'js-yaml'
import type { FakeFileSpec } from '../helpers/fakeVault'

const SKIP = new Set(['.obsidian', '.trash', '.git'])
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function loadDiskVault(root: string, folder = ''): FakeFileSpec[] {
  const specs: FakeFileSpec[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const rel = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(rel)
        continue
      }
      const normal = rel.normalize('NFC')
      if (!entry.name.endsWith('.md')) {
        specs.push({ path: normal, raw: '' })
        continue
      }
      const raw = fs.readFileSync(path.join(root, rel), 'utf8')
      const match = FRONTMATTER.exec(raw)
      let frontmatter: Record<string, unknown> | undefined
      if (match) {
        try {
          const parsed = load(match[1], { schema: CORE_SCHEMA })
          if (parsed && typeof parsed === 'object') frontmatter = parsed as Record<string, unknown>
        } catch {
          frontmatter = undefined
        }
      }
      specs.push({
        path: normal,
        frontmatter,
        content: match ? raw.slice(match[0].length) : raw,
        raw,
      })
    }
  }
  walk(folder)
  return specs
}
