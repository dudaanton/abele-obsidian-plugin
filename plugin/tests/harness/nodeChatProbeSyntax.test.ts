import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'

/** Parse the actual emitted browser programs; TypeScript cannot see inside an eval string. */
it.each([0, 1])('parses the node chat and paired browser probes (project %s)', (i) => {
  for (const file of ['nodeChat', 'nodePaired']) {
    const source = readFileSync(`tests/e2e/${file}.e2e.test.ts`, 'utf8')
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const declarations: Record<string, string> = {}
    const probes: string[] = []
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ['PRELUDE', 'PANEL', 'prelude'].includes(node.name.getText(tree))
      )
        declarations[node.name.getText(tree)] = node.initializer!.getText(tree)
      if (
        ts.isCallExpression(node) &&
        ['evalAsync', 'evalLong'].includes(node.expression.getText(tree))
      ) {
        const code = node.arguments[0]?.getText(tree) ?? ''
        if (
          code.includes('const worktree =') ||
          code.includes('evidenceHidden') ||
          code.includes('const resolved=')
        )
          probes.push(code)
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
    const scope: Record<string, unknown> = {
      i,
      registrationId: 'sample-registration',
      projectPaths: ['/sample/one', '/sample/two'],
      projectPath: '/sample/project',
      folderName: i === 0 ? 'one' : 'two',
      branch: 'sample-topic',
      sessionId: 'sample-session',
      invite: { node_id: 'sample-node' },
    }
    for (const [name, code] of Object.entries(declarations))
      scope[name] = new Function(...Object.keys(scope), `return ${code}`)(...Object.values(scope))
    expect(probes).toHaveLength(file === 'nodeChat' ? 2 : 1)
    for (const code of probes) {
      const script = new Function(...Object.keys(scope), `return ${code}`)(...Object.values(scope))
      expect(() => new Function(`return ${script}`)).not.toThrow()
    }
  }
})
