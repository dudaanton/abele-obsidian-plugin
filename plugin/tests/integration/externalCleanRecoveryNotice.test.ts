import { expect, it } from 'vitest'
import { externalFileFixture as fixture } from './externalFileFollowupFixture'
import { Notice } from 'obsidian'
it('does not warn about routine retained evidence after a clean round trip and departure', async () => {
  const s = await fixture()
  const count = Notice.shown.length
  try {
    expect((await s.port.evict(s.path)).status).toBe('complete')
    await s.port.hydrate(s.path)
    await s.port.prepareDisconnect()
    expect(await s.app.vault.adapter.read(s.path)).toBe('sample original bytes')
    expect(
      Notice.shown.slice(count).filter((message) => message.includes('recoverable copies'))
    ).toEqual([])
  } finally {
    s.close()
  }
})
