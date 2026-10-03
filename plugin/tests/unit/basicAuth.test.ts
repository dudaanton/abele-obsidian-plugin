import { describe, expect, it } from 'vitest'
import { basicCredentials, encodeBasicCredentials } from '@/secrets/basicAuth'

describe('bounded Basic credential identity', () => {
  it('compares the whole password after the first colon, including UTF-8 and later colons', () => {
    const header = encodeBasicCredentials('sample-user', 'fake-päss:word')
    expect(basicCredentials(header)).toEqual({
      username: 'sample-user',
      password: 'fake-päss:word',
    })
    expect(basicCredentials(header.toLowerCase().slice(0, 5) + header.slice(5))).toEqual({
      username: 'sample-user',
      password: 'fake-päss:word',
    })
  })
  it.each([
    'Basic !!!',
    'Basic dXNlcg==',
    'Basic /zpw',
    'Basic dTpw===',
    'Basic dTpw\n',
    'Basic dTpw another',
    'Basic dTo= '.repeat(3000),
  ])('refuses malformed or oversized material without echoing it', (header) => {
    expect(basicCredentials(header)).toBeNull()
  })
  it('does not accept data without a Basic scheme or a non-canonical encoding', () => {
    expect(
      basicCredentials('sample-prefix ' + encodeBasicCredentials('sample', 'fake-value'))
    ).toBeNull()
    expect(basicCredentials('Basic dTp=')).toBeNull()
  })
  it('refuses an ambiguous username and control characters without normalizing passwords', () => {
    expect(() => encodeBasicCredentials('sample:other', 'fake-value')).toThrow()
    expect(() => encodeBasicCredentials('sample', 'fake-value\n')).toThrow()
    expect(basicCredentials(encodeBasicCredentials('', '  fake-value  '))?.password).toBe(
      '  fake-value  '
    )
  })
})
