import { describe, expect, it } from 'vitest'
import {
  addressOf,
  evaluateChecks,
  keyNamesOf,
  missingVars,
  outgoing,
  pairsForView,
  toCurl,
  varsOf,
} from '@/requests/resolve'
import type { RequestDoc, EnvironmentDoc } from '@/requests/wire'

it('adds JSON Content-Type unless the user supplied an active one', () => {
  const request = doc({ headers: [] })
  expect(outgoing(request, {}).headers).toEqual({ 'Content-Type': 'application/json' })
  request.headers = [{ key: 'content-type', value: 'application/custom' }]
  expect(outgoing(request, {}).headers).toEqual({ 'content-type': 'application/custom' })
  request.headers[0]!.off = true
  expect(outgoing(request, {}).headers).toEqual({ 'Content-Type': 'application/json' })
})

const doc = (over: Partial<RequestDoc> = {}): RequestDoc => ({
  name: 'Create sample',
  method: 'POST',
  url: '{{base}}/samples/{{id}}',
  params: [
    { key: 'q', value: 'a b&{{tag}}' },
    { key: 'sig', value: '${abele_key:sample-key}' },
    { key: 'debug', value: '1', off: true },
  ],
  headers: [
    { key: 'Authorization', value: 'Bearer ${abele_key:sample-key}' },
    { key: 'X-Off', value: 'x', off: true },
    { key: 'X-Token', value: '{{token}}' },
  ],
  body: { format: 'json', text: '{"tag":"{{tag}}"}' },
  scripts: {},
  checks: [],
  ...over,
})
const env: EnvironmentDoc = {
  name: 'local',
  vars: [
    { key: 'base', value: 'http://localhost:4000' },
    { key: 'id', value: '7' },
    { key: 'tag', value: 'red' },
    { key: 'unused', value: 'x', off: true },
    { key: 'token', secret: true },
  ],
}

describe('a saved request made ready to go', () => {
  it('puts the environment in, secrets from memory, and leaves keys by name', () => {
    const vars = varsOf(env, { token: 'tok-123' })
    expect(vars).toEqual({ base: 'http://localhost:4000', id: '7', tag: 'red', token: 'tok-123' })
    expect(addressOf(doc(), vars)).toBe(
      'http://localhost:4000/samples/7?q=a%20b%26red&sig=${abele_key:sample-key}'
    )
    const out = outgoing(doc(), vars)
    expect(out).toEqual({
      method: 'POST',
      url: 'http://localhost:4000/samples/7?q=a%20b%26red&sig=${abele_key:sample-key}',
      headers: {
        Authorization: 'Bearer ${abele_key:sample-key}',
        'X-Token': 'tok-123',
        'Content-Type': 'application/json',
      },
      body: '{"tag":"red"}',
    })
    expect(keyNamesOf(doc())).toEqual(['sample-key'])
  })

  it('names the variables this environment has no value for', () => {
    expect(missingVars(doc(), varsOf(env, {}))).toEqual(['token'])
    expect(missingVars(doc({ url: '{{nowhere}}/x' }), varsOf(env, { token: 't' }))).toEqual([
      'nowhere',
    ])
  })

  it('never sends a body with GET', () => {
    expect(outgoing(doc({ method: 'GET' }), varsOf(env, { token: 't' })).body).toBeUndefined()
  })

  it('copies as curl with keys left by name', () => {
    const curl = toCurl(outgoing(doc(), varsOf(env, { token: 't' })))
    expect(curl).toContain(`curl -X POST 'http://localhost:4000/samples/7?q=a%20b%26red`)
    expect(curl).toContain(`-H 'Authorization: Bearer \${abele_key:sample-key}'`)
    expect(curl).toContain(`--data-raw '{"tag":"red"}'`)
    expect(toCurl({ method: 'GET', url: "http://x/'q'", headers: {} })).toBe(
      `curl 'http://x/'\\''q'\\'''`
    )
  })

  it('marks a key line as a key, and one the plugin does not have as missing', () => {
    const pairs = pairsForView(doc().headers, (name) => name !== 'sample-key')
    expect(pairs[0]).toEqual({
      key: 'Authorization',
      value: 'Bearer ${abele_key:sample-key}',
      secret: true,
      missing: 'The key sample-key is not on this device',
    })
    expect(pairsForView(doc().headers, () => true)[0]).not.toHaveProperty('missing')
  })
})

describe('checks of an answer', () => {
  const answer = {
    status: 201,
    ms: 84,
    bytes: 1200,
    headers: [{ key: 'content-type', value: 'application/json; charset=utf-8' }],
    body: '{"id":"o-1","items":[{"qty":2}],"ok":true}',
  }
  it('reads status, time, headers and paths into a JSON body', () => {
    expect(
      evaluateChecks(
        [
          'status == 201',
          'status < 400',
          'ms < 50',
          'header content-type contains json',
          'body.id == "o-1"',
          'body.items[0].qty == 2',
          'body.ok == true',
          'body contains o-1',
          'body.missing == 1',
          'what is this',
        ],
        answer
      )
    ).toEqual([
      { text: 'status == 201', passed: true },
      { text: 'status < 400', passed: true },
      { text: 'ms < 50', passed: false },
      { text: 'header content-type contains json', passed: true },
      { text: 'body.id == "o-1"', passed: true },
      { text: 'body.items[0].qty == 2', passed: true },
      { text: 'body.ok == true', passed: true },
      { text: 'body contains o-1', passed: true },
      { text: 'body.missing == 1', passed: false },
      { text: 'what is this', passed: false },
    ])
  })
})
