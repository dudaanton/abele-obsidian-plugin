import { beforeEach, afterEach, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TokenSyncLive } from './tokenSyncLive'
import { onPhone } from './target'
import { driver } from './phone'
import { shotDir } from './shots'
export function liveSuite(peer = true): () => TokenSyncLive {
  let current: TokenSyncLive
  beforeEach(async () => {
    current = new TokenSyncLive(peer)
    await current.start()
  })
  afterEach(async () => {
    if (current) await current.close()
  })
  return () => current
}
export const liveSyncFiles = [
  'sync',
  'syncJoin',
  'syncDevices',
  'syncDeletes',
  'syncSettings',
  'syncDialogs',
  'syncTransfer',
  'syncPhone',
  'personalBaseline',
]
export function mappedSyncCases(): { file: string; name: string; scenarios: number[] }[] {
  return liveSyncFiles.flatMap((file) => {
    const source = readFileSync(
      fileURLToPath(new URL('../' + file + '.e2e.test.ts', import.meta.url)),
      'utf8'
    )
    return [...source.matchAll(/liveCase\(\s*'([^']+)',\s*'([^']+)',\s*\[([\d,\s]+)\]/g)].map(
      (one) => ({ file: one[1], name: one[2], scenarios: one[3].split(',').map(Number) })
    )
  })
}
export function caseKey(file: string, name: string): string {
  return createHash('sha256')
    .update(file + ':' + name)
    .digest('hex')
    .slice(0, 16)
}
export function evidenceDirectory(): string {
  return process.env.ABELE_SCENARIO_EVIDENCE || shotDir('abele-sync-evidence')
}
export function liveCase(
  file: string,
  name: string,
  scenarios: number[],
  body: () => Promise<void>,
  fixture: () => TokenSyncLive
): void {
  it(
    name,
    async () => {
      const platform = onPhone() ? 'iPhone' : 'Mac',
        key = caseKey(file, name),
        output = evidenceDirectory(),
        artifact = join(output, key + '-' + platform + '.png')
      mkdirSync(output, { recursive: true })
      let error: unknown
      try {
        const before = expect.getState().assertionCalls
        await body()
        if (expect.getState().assertionCalls === before)
          throw new Error('Live case supplied no behavioral assertions')
      } catch (one) {
        error = one
      }
      try {
        if (onPhone()) driver(['shot', artifact])
        else
          fixture().primary.run(
            `const fs=require('fs'); const win=require('@electron/remote').getCurrentWindow(); fs.writeFileSync(${JSON.stringify(artifact)},(await win.webContents.capturePage()).toPNG());return true`
          )
      } catch (one) {
        error ||= one
      }
      // A cleanup failure is a failed scenario, never verified evidence.
      try {
        await fixture().close()
      } catch (one) {
        error = error ? new AggregateError([error, one], 'Live case and cleanup failed') : one
      }
      for (const scenario of scenarios)
        writeFileSync(
          join(output, String(scenario).padStart(3, '0') + '-' + platform + '-' + key + '.json'),
          JSON.stringify(
            {
              scenario: String(scenario).padStart(3, '0'),
              platform,
              driver: onPhone() ? 'physical-phone' : 'desktop',
              case: { file, name },
              runId: process.env.ABELE_SYNC_EVIDENCE_RUN || null,
              status: error ? 'failed' : 'verified',
              checks: [{ name, expected: true, actual: !error }],
              artifacts: [artifact],
              recordedAt: new Date().toISOString(),
            },
            null,
            2
          ) + '\n'
        )
      if (error) throw error
    },
    180000
  )
}
