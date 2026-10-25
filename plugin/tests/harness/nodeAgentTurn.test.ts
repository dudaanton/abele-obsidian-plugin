import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { nodeAgentTurn } from '../e2e/helpers/nodeAgentTurn'

it('emits parseable model SSE and restores fetch after a scripted vault turn', async () => {
  const originalFetch: typeof fetch = async () => new Response('unrelated')
  const streams: string[] = []
  const browser = {
    fetch: originalFetch,
    __abeleTest: {
      ChatService: { getInstance: () => ({ getSessionByFile: () => session }) },
    },
  }
  const session = {
    summarizer: {},
    allMessages: { value: [] },
    error: { value: '' },
    async sendMessage() {
      for (let i = 0; i < 2; i++) {
        const response = await browser.fetch(
          'https://sample-node-files-model.invalid/v1/chat/completions',
          { body: JSON.stringify({ messages: [], tools: [{ function: { name: 'node_read' } }] }) }
        )
        streams.push(await response.text())
      }
    },
  }
  const result = JSON.parse(
    await new Function(
      'window',
      `return ${nodeAgentTurn('Sample.abchat', "[async()=>({name:'node_read',params:{path:'sample.txt'}})]")}`
    )(browser)
  )
  expect(result.tools).toEqual(['node_read'])
  expect(streams[0].split('\n\n')).toHaveLength(4)
  expect(
    JSON.parse(streams[0].split('\n\n')[0].slice(6)).choices[0].delta.tool_calls[0].function
  ).toEqual({ name: 'node_read', arguments: '{"path":"sample.txt"}' })
  expect(streams[1]).toContain('"content":"Done."')
  expect(browser.fetch).toBe(originalFetch)
})

it('passes expressions to the long-running browser evaluator', () => {
  const source = readFileSync('tests/e2e/nodeVaultAgentActions.e2e.test.ts', 'utf8')
  const tree = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true)
  const scripts: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ['evalLong', 'turn'].includes(node.expression.getText(tree))) {
      const argument = node.arguments[0]
      if (
        ts.isTemplateExpression(argument) ||
        ts.isNoSubstitutionTemplateLiteral(argument) ||
        ts.isStringLiteral(argument)
      ) {
        scripts.push(
          new Function(
            'node',
            'chat',
            'setup',
            'nodeAgentTurn',
            'receipt',
            `return ${argument.getText(tree)}`
          )(
            { registration: 'sample-registration', node: 'sample-node' },
            'Sample.abchat',
            '',
            nodeAgentTurn,
            { session_id: 'sample-context', run_id: 'sample-run' }
          )
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  expect(scripts.length).toBeGreaterThan(5)
  for (const script of scripts)
    expect(() => new Function(`return (${script})`), script).not.toThrow()
})
