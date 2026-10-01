// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MemoryStateStore } from '@abele/sync-core'
import { ScriptProvenance, type ScriptBinding } from '@/scripting/trust/ScriptProvenance'

const binding: ScriptBinding = {
  localVault: 'sample-local',
  endpoint: 'https://sync.example',
  vaultId: 'sample-vault',
  principal: 'sample-device',
  facet: 'personal',
  grantId: null,
}

describe('durable script managed provenance', () => {
  it('keeps adoption and arbitrary rename/restore associated with the remote identity', async () => {
    const meta = new MemoryStateStore()
    const provenance = await ScriptProvenance.open(meta, binding, true)
    await provenance.record('Scripts/sample.js', 'sample-file')
    await provenance.rename('Scripts/sample.js', 'Media/sample.png')
    const reopened = await ScriptProvenance.open(meta, binding, false)
    expect(await reopened.lookup('Media/sample.png')).toMatchObject({
      fileId: 'sample-file',
      binding,
    })
    await reopened.record('Scripts/restored.js', 'sample-file')
    expect(await reopened.lookup('Scripts/restored.js')).toMatchObject({ fileId: 'sample-file' })
  })
  it('records an unknown hold before replacement, which persists after a crash', async () => {
    const meta = new MemoryStateStore()
    const provenance = await ScriptProvenance.open(meta, binding, true)
    await provenance.pending('Scripts/sample.js')
    const reopened = await ScriptProvenance.open(meta, binding, false)
    expect(await reopened.lookup('Scripts/sample.js')).toMatchObject({ fileId: null })
  })
  it('never fabricates a new local store after an existing sentinel loses its database', async () => {
    await expect(ScriptProvenance.open(new MemoryStateStore(), binding, false)).rejects.toThrow(
      /missing/
    )
  })
  it('does not reuse a record after endpoint/principal/grant switch', async () => {
    const meta = new MemoryStateStore()
    const first = await ScriptProvenance.open(meta, binding, true)
    await first.record('Scripts/sample.js', 'sample-file')
    const next = await ScriptProvenance.open(
      meta,
      { ...binding, facet: 'scoped', grantId: 'sample-grant', principal: 'sample-reader' },
      false
    )
    expect(await next.lookup('Scripts/sample.js')).toBeNull()
  })
})
