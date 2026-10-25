import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { nodeAgentTurn } from '../e2e/helpers/nodeAgentTurn'

it('keeps the fake provider installed while a vault tool waits for owner approval', async () => {
  const originalFetch: typeof fetch = async () => new Response('unrelated')
  const session = {
    summarizer: {},
    allMessages: { value: [] as Record<string, unknown>[] },
    error: { value: '' },
    pendingToolCalls: { value: ['sample-call'] },
    isStreaming: { value: false },
    isExecutingTool: { value: false },
    sendMessage: async () => {},
  }
  const browser = {
    fetch: originalFetch,
    __abeleTest: { ChatService: { getInstance: () => ({ getSessionByFile: () => session }) } },
  }
  const completed = new Function('window', `return ${nodeAgentTurn('Sample.abchat', '[]')}`)(
    browser
  )
  await new Promise((resolve) => setTimeout(resolve, 5))
  try {
    expect(browser.fetch).not.toBe(originalFetch)
    session.allMessages.value.push({
      role: 'tool-call',
      toolName: 'node_write',
      toolParams: {},
      toolResult: 'saved',
    })
  } finally {
    session.pendingToolCalls.value = []
  }
  expect(JSON.parse(await completed).calls).toEqual([
    { name: 'node_write', params: {}, result: 'saved' },
  ])
  expect(browser.fetch).toBe(originalFetch)
})

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
  await new Function(
    'window',
    `return ${nodeAgentTurn('Sample.abchat', "[()=>({name:'node_read',params:{path:'sample.txt'}})]")}`
  )(browser)
  const callId = (stream: string) =>
    JSON.parse(stream.split('\n\n')[0].slice(6)).choices[0].delta.tool_calls[0].id
  expect(callId(streams[2])).not.toBe(callId(streams[0]))
})

it.each([false, true])(
  'passes expressions to the long-running browser evaluator (plain folder: %s)',
  (plain) => {
    const source = readFileSync('tests/e2e/nodeVaultAgentActions.e2e.test.ts', 'utf8')
    const tree = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.Latest, true)
    const scripts: string[] = []
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ['evalLong', 'turn'].includes(node.expression.getText(tree))
      ) {
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
              'plain',
              'plainPath',
              `return ${argument.getText(tree)}`
            )(
              { registration: 'sample-registration', node: 'sample-node' },
              'Sample.abchat',
              '',
              nodeAgentTurn,
              { session_id: 'sample-context', run_id: 'sample-run' },
              plain,
              '/sample/plain'
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
  }
)
