#!/usr/bin/env node
// Invented stream-json and real stdio bridge traffic. No model or authentication service.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
if (process.argv.includes('--version')) {
  console.log('2.1.291 (Claude Code)')
  process.exit()
}
if (process.argv.includes('--help')) {
  console.log(
    '--include-partial-messages --forward-subagent-text --resume --setting-sources --max-budget-usd'
  )
  process.exit()
}
const emit = (value) => console.log(JSON.stringify(value))
let text = ''
for await (const chunk of process.stdin) text += chunk
const at = process.argv.indexOf('--resume')
const native = at < 0 ? '11111111-1111-4111-8111-111111111111' : process.argv[at + 1]
appendFileSync(
  'fixture-turns.jsonl',
  JSON.stringify({ text, resume: at < 0 ? null : native }) + '\n'
)
emit({ type: 'system', subtype: 'init', session_id: native })
if (text === 'edit' || text === 'deny') {
  const input = { file_path: 'sample.txt', old_string: 'before\n', new_string: 'after\n' }
  emit({
    type: 'assistant',
    message: {
      id: 'tool-message',
      content: [{ type: 'tool_use', id: 'sample-edit', name: 'Edit', input }],
    },
  })
  const spec = JSON.parse(
    readFileSync(process.argv[process.argv.indexOf('--mcp-config') + 1], 'utf8')
  ).mcpServers.abele_approval
  const bridge = spawn(spec.command, spec.args, {
    env: { ...process.env, ...spec.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  bridge.stderr.resume()
  const behavior = await new Promise((resolve, reject) => {
    let output = ''
    bridge.on('error', reject)
    bridge.on('exit', () => {
      if (!output.includes('\n')) reject(new Error('Fixture bridge closed without an answer'))
    })
    bridge.stdout.on('data', (chunk) => {
      output += chunk
      if (!output.includes('\n')) return
      try {
        resolve(JSON.parse(JSON.parse(output.split('\n')[0]).result.content[0].text).behavior)
        bridge.stdin.end()
      } catch (error) {
        reject(error)
      }
    })
    bridge.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'permission',
          arguments: { tool_name: 'Edit', tool_use_id: 'sample-edit', input },
        },
      }) + '\n'
    )
  })
  if (behavior === 'allow') writeFileSync('sample.txt', 'after\n')
  emit({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'sample-edit',
          content: behavior === 'allow' ? 'Edited sample file' : 'Permission denied',
          is_error: behavior !== 'allow',
        },
      ],
    },
  })
}
emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'answer' } } })
emit({
  type: 'stream_event',
  event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
})
emit({
  type: 'stream_event',
  event: {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Partial answer' },
  },
})
emit({
  type: 'assistant',
  message: { id: 'answer', content: [{ type: 'text', text: `**Finished:** ${text}` }] },
})
emit({
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: native,
  result: 'Finished',
})
