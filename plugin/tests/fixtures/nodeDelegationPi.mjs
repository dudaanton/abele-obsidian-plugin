// Deterministic pi host seam. Never imports the SDK, opens credentials or performs model calls.
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export async function createHost(config, ask, signal, emit) {
  const native = config.native_session_id ?? randomUUID()
  const file = config.native_session_file ?? join(config.sessionDir, native + '.jsonl')
  mkdirSync(config.sessionDir, { recursive: true, mode: 0o700 })
  writeFileSync(
    file,
    JSON.stringify({
      type: 'session',
      version: 3,
      id: native,
      timestamp: '2028-01-01T00:00:00Z',
      cwd: config.cwd,
    }) + '\n',
    { mode: 0o600 }
  )
  emit({ type: 'pi.session.bound', data: { native_session_id: native, native_session_file: file } })
  return {
    prompt: async (text) => {
      if (text.includes('human-task')) {
        const answer = await ask(
          {
            kind: 'confirm',
            tool_use_id: 'sample-question',
            native_session_id: native,
            tool_name: 'sample_confirm',
            input: {},
            title: 'Approve sample child action?',
          },
          signal
        )
        if (answer.choice !== 'allow' || answer.delivered() === false)
          return { subtype: 'error', is_error: true }
      } else await new Promise((resolve) => setTimeout(resolve, 6000))
      const report =
        '```abele-worker-report\n' +
        JSON.stringify({
          report_id: 'sample-result',
          kind: 'result',
          text: 'Sample pi delegated result',
        }) +
        '\n```'
      emit({
        type: 'pi.message.final',
        data: {
          native_session_id: native,
          message_id: 'sample-answer',
          replaces_partials: true,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: report }],
            stopReason: 'stop',
          },
        },
      })
      return { subtype: 'success', is_error: false }
    },
    completionResult: (result) => result,
    abort: async () => {},
    dispose: async () => {},
  }
}
