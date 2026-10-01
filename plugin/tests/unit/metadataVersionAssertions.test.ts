// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { assertVersionEvidence, VERSION_TOKENS } from '../e2e/helpers/metadataVersionAssertions'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
function evidence() {
  const root = 'SampleProbe',
    pastedName = 'pasted-sample.png'
  const versions: Record<string, any> = {}
  for (const version of ['remote', 'applied', 'local', 'merged', 'pasted'] as const) {
    const tokens =
      version === 'pasted'
        ? {
            links: VERSION_TOKENS.merged.links,
            embeds: [...VERSION_TOKENS.merged.embeds, pastedName],
          }
        : VERSION_TOKENS[version]
    const source =
      version +
      '\n' +
      [
        ...tokens.links.map((link) => `[[${link}]]`),
        ...tokens.embeds.map((link) => `![[${link}]]`),
      ].join('\n')
    const token = (link: string, embed: boolean) => {
      const original = `${embed ? '!' : ''}[[${link}]]`
      const offset = source.indexOf(original)
      return {
        link,
        original,
        position: { start: { offset }, end: { offset: offset + original.length } },
      }
    }
    const cache = {
      links: tokens.links.map((link) => token(link, false)),
      embeds: tokens.embeds.map((link) => token(link, true)),
    }
    const links = [
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
    versions[version] = {
      source,
      sha: sha(source),
      evidence: {
        data: source,
        sha: sha(source),
        cacheHash: sha(JSON.stringify(cache)),
        cache,
        links,
      },
    }
  }
  return { root, versions, pasteOrder: [{ kind: 'create', path: root + '/' + pastedName }] }
}

describe('exact metadata/cache feasibility oracle', () => {
  it('accepts all exact independently known fixture sets', () => {
    assertVersionEvidence(evidence())
  })
  it.each([
    ['applied', 'remote'],
    ['local', 'applied'],
    ['merged', 'local'],
    ['pasted', 'merged'],
  ])('rejects %s data paired with %s cache', (target, stale) => {
    const result = evidence()
    const original = result.versions[stale].evidence
    Object.assign(result.versions[target].evidence, {
      cache: original.cache,
      cacheHash: original.cacheHash,
      links: original.links,
    })
    expect(() => assertVersionEvidence(result)).toThrow()
  })
  it('rejects foreign links even when all expected facts are present', () => {
    const result = evidence()
    result.versions.applied.evidence.links.push({
      kind: 'link',
      spelling: 'foreign-only',
      original: '[[foreign-only]]',
      path: null,
      targetId: null,
    })
    expect(() => assertVersionEvidence(result)).toThrow()
  })
  it('rejects cache positions that do not correspond to event data', () => {
    const result = evidence()
    result.versions.local.evidence.cache.links[0].position.start.offset++
    result.versions.local.evidence.cacheHash = sha(
      JSON.stringify(result.versions.local.evidence.cache)
    )
    expect(() => assertVersionEvidence(result)).toThrow()
  })
})
