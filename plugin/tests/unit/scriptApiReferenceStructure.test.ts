import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { SCRIPT_API_DOCS } from '@/scripting/apiDocs'

function runtimeNames(name: string): string[] {
  const source = ts.createSourceFile(
    'ScriptService.ts',
    readFileSync('src/scripting/ScriptService.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const names: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      const collect = (child: ts.Node) => {
        if (ts.isStringLiteral(child)) names.push(child.text)
        ts.forEachChild(child, collect)
      }
      collect(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return names
}
const documentedNames = (heading: string) => {
  const section =
    SCRIPT_API_DOCS.split(`### ${heading}\n`)[1]?.split('\n### ')[0]?.split('\n## ')[0] ?? ''
  return [...section.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((match) => match[1])
}

describe('the scripting reference structure and runtime lists', () => {
  it('keeps every file-operation row inside one uninterrupted Markdown table', () => {
    const lines = SCRIPT_API_DOCS.split('\n')
    const first = lines.findIndex((line) => line.startsWith('| `read(path)`'))
    const last = lines.findIndex((line) => line.startsWith('| `noteInfo(path)`'))
    expect(first).toBeGreaterThan(0)
    expect(last).toBeGreaterThan(first)
    expect(lines.slice(first, last + 1).every((line) => line.startsWith('|'))).toBe(true)
  })

  it('documents the literal reserved names and lint-readable globals from the runtime', () => {
    expect(documentedNames('Reserved names')).toEqual(runtimeNames('SCRIPT_GLOBALS'))
    expect(documentedNames('Lint-rule globals')).toEqual(runtimeNames('LINT_READS'))
  })

  it('has one library section and one selection-context section for books', () => {
    expect(SCRIPT_API_DOCS.match(/^### books —/gm)).toHaveLength(1)
    expect(SCRIPT_API_DOCS.match(/^### book —/gm)).toHaveLength(1)
  })
})
