// @vitest-environment node
import { expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { rendererEntries } from '../scale/evidence.mjs'

it('streams renderer receipts and retains only reads within the restart window', async () => {
  async function* chunks() {
    for (let i = 0; i < 20000; i++)
      yield JSON.stringify({ event: 'content-read-start', at: i, stack: 'x'.repeat(200) }) + '\n'
    yield '{"event":"renderer-start","at":20001}\n{"event":"content-read-'
    yield 'finish","at":20002,"bytes":17}\n{"event":"reindex-complete","at":20003}\n'
  }
  const rows = await rendererEntries(Readable.from(chunks()), 20000)
  expect(rows).toEqual([
    { event: 'renderer-start', at: 20001 },
    { event: 'content-read-finish', at: 20002, bytes: 17 },
    { event: 'reindex-complete', at: 20003 },
  ])
})

it('fails closed on corrupt completed receipts and tolerates only a live partial tail', async () => {
  await expect(rendererEntries(Readable.from(['bad\n{}\n']))).rejects.toThrow()
  await expect(rendererEntries(Readable.from(['{"event":']))).rejects.toThrow()
  expect(await rendererEntries(Readable.from(['{}\n{"event":']), undefined, true)).toEqual([{}])
  await expect(rendererEntries(Readable.from(['bad\n{}\n']), undefined, true)).rejects.toThrow()
  await expect(rendererEntries(Readable.from(['bad\n']), undefined, true)).rejects.toThrow()
})

it('keeps observer errors but excludes pre-restart read volume without a restart', async () => {
  const rows = await rendererEntries(
    Readable.from([
      '{"event":"content-read-start","at":1}\n{"event":"content-read-ready","at":2}\n',
      '{"event":"content-read-error","at":3}\n{"event":"write-start","at":4}\n',
    ])
  )
  expect(rows.map((row) => row.event)).toEqual(['content-read-error', 'write-start'])
})
