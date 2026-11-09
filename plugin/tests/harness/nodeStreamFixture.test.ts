import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it.each(['text', 'blocks'])('streams work commands supplied as %s', async (shape) => {
  const cwd = mkdtempSync(join(tmpdir(), 'sample-stream-'))
  try {
    const text = 'work sampleturn 2 1'
    const content = shape === 'text' ? text : [{ type: 'text', text }]
    const output = await new Promise<string>((resolveOutput, reject) => {
      const child = execFile(
        process.execPath,
        [resolve('tests/fixtures/nodeClaudeLive.mjs')],
        { cwd, timeout: 3000 },
        (error, stdout) => (error ? reject(error) : resolveOutput(stdout))
      )
      child.stdin!.end(
        JSON.stringify({ type: 'user', message: { content }, uuid: 'sample-input' }) + '\n'
      )
    })
    const events = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      events
        .filter((e) => e.type === 'stream_event' && e.event.type === 'content_block_delta')
        .map((e) => e.event.delta.text)
        .join('')
    ).toContain('sampleturn word0:')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
