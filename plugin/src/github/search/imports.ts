import type { RepositoryTree } from '@/repository/source'
import { findNode } from '../tree/fileTree'

import { javascriptLanguage } from '@codemirror/lang-javascript'

const parser = javascriptLanguage.parser.configure({ dialect: 'ts jsx' })

/** Module specifiers only; offsets exclude the surrounding quotes. */
export function importedPaths(text: string): { from: number; to: number; text: string }[] {
  const out: { from: number; to: number; text: string }[] = []
  parser.parse(text).iterate({
    enter(node) {
      if (node.name !== 'String') return
      const parent = node.node.parent
      const owner = parent?.name === 'ArgList' ? parent.parent : parent
      const module =
        owner?.name === 'ImportDeclaration' ||
        (owner?.name === 'ExportDeclaration' && node.node.prevSibling?.name === 'from') ||
        owner?.name === 'DynamicImport' ||
        (owner?.name === 'CallExpression' &&
          text.slice(owner.firstChild.from, owner.firstChild.to) === 'require' &&
          parent?.firstChild?.nextSibling?.from === node.from)
      const value = text.slice(node.from + 1, node.to - 1)
      if (module && /^\.{1,2}\//.test(value))
        out.push({ from: node.from + 1, to: node.to - 1, text: value })
    },
  })
  return out
}

const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.vue', '.d.ts']

/** Uses the tab's cached tree, expanding lazy folders only when clicked. */
export async function resolveImport(
  tree: Pick<RepositoryTree, 'root' | 'reveal'>,
  fromPath: string,
  specifier: string
): Promise<string | null> {
  if (!/^\.{1,2}\//.test(specifier)) return null
  const parts = fromPath.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  const path = parts.join('/')
  const candidates = [
    path,
    ...extensions.map((ext) => path + ext),
    ...extensions.map((ext) => `${path}/index${ext}`),
  ]
  for (const candidate of candidates) {
    await tree.reveal(candidate)
    if (findNode(tree.root, candidate)?.kind === 'file') return candidate
  }
  return null
}
