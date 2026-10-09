#!/usr/bin/env node
// Deterministic, non-executing provider fixture. No model, credentials or shell actions.
import { randomUUID } from 'node:crypto'
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
let input = ''
for await (const chunk of process.stdin) input += chunk
const native = randomUUID()
const emit = (value) => console.log(JSON.stringify(value))
emit({ type: 'system', subtype: 'init', session_id: native })
await new Promise((resolve) => setTimeout(resolve, 6000))
const report =
  '```abele-worker-report\n' +
  JSON.stringify({
    report_id: 'sample-result',
    kind: 'result',
    text: 'Sample Claude delegated result',
  }) +
  '\n```'
emit({
  type: 'assistant',
  message: { id: 'sample-answer', content: [{ type: 'text', text: report }] },
})
emit({
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: native,
  result: 'Sample task complete',
})
