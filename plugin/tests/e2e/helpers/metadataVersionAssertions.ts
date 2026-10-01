import { createHash } from 'node:crypto'
import { expect } from 'vitest'

/** Independent fixture oracle: these token sets do not come from the observed cache. */
export const VERSION_TOKENS = {
  remote: { links: ['original-only'], embeds: ['original.png'] },
  applied: { links: ['applied-only', 'applied-unresolved'], embeds: ['applied.png'] },
  local: { links: ['local-only', 'local-second'], embeds: ['local.png'] },
  merged: { links: ['merged-only', 'local-only'], embeds: ['merged.png', 'applied.png'] },
}
const sorted = (facts: any[]) =>
  [...facts].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

/** Exact completeness plus token positions bind this known cache's facts to these bytes. */
export function assertVersionEvidence(result: any): void {
  const root = result.root
  const pastedPath = result.pasteOrder.find((event: any) => event.kind === 'create')?.path
  expect(pastedPath).toMatch(new RegExp('^' + root + '/'))
  const pastedName = pastedPath.slice(root.length + 1)
  for (const version of ['remote', 'applied', 'local', 'merged', 'pasted'] as const) {
    const snapshot = result.versions[version]
    const evidence = snapshot.evidence
    expect(evidence.data).toBe(snapshot.source)
    expect(evidence.sha).toBe(createHash('sha256').update(snapshot.source).digest('hex'))
    expect(snapshot.sha).toBe(evidence.sha)
    expect(evidence.cacheHash).toBe(
      createHash('sha256').update(JSON.stringify(evidence.cache)).digest('hex')
    )
    const tokens =
      version === 'pasted'
        ? {
            links: VERSION_TOKENS.merged.links,
            embeds: [...VERSION_TOKENS.merged.embeds, pastedName],
          }
        : VERSION_TOKENS[version]
    const expected = [
      ...tokens.links.map((spelling) => ({
        kind: 'link',
        spelling,
        original: `[[${spelling}]]`,
        path: null,
        targetId: null,
      })),
      ...tokens.embeds.map((spelling) => ({
        kind: 'embed',
        spelling,
        original: `![[${spelling}]]`,
        path: `${root}/${spelling}`,
        targetId: spelling === pastedName ? null : `${spelling.slice(0, -4)}-target-id`,
      })),
    ]
    // Check both raw cache tables and the copied/resolved facts, including absent foreign tokens.
    expect(
      sorted(
        (evidence.cache.links ?? []).map((link: any) => ({
          spelling: link.link,
          original: link.original,
        }))
      )
    ).toEqual(
      sorted(
        expected
          .filter((one) => one.kind === 'link')
          .map(({ spelling, original }) => ({ spelling, original }))
      )
    )
    expect(
      sorted(
        (evidence.cache.embeds ?? []).map((link: any) => ({
          spelling: link.link,
          original: link.original,
        }))
      )
    ).toEqual(
      sorted(
        expected
          .filter((one) => one.kind === 'embed')
          .map(({ spelling, original }) => ({ spelling, original }))
      )
    )
    expect(sorted(evidence.links)).toEqual(sorted(expected))
    for (const token of [...(evidence.cache.links ?? []), ...(evidence.cache.embeds ?? [])]) {
      expect(evidence.data.slice(token.position.start.offset, token.position.end.offset)).toBe(
        token.original
      )
    }
  }
}
