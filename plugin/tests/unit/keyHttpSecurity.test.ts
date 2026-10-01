import { beforeEach, describe, expect, it } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { checkKeyTransport, allowHttpOrigin, allowedHttpOrigins } from '@/secrets/keyTransport'

beforeEach(() => useVault([]))
describe('unencrypted credentials', () => {
  it('accepts HTTPS and loopback HTTP without an exception', () => {
    for (const url of [
      'https://api.sample.example/',
      'http://localhost:1234/',
      'http://127.0.0.1/',
      'http://[::1]/',
    ])
      expect(() => checkKeyTransport(url)).not.toThrow()
  })
  it('holds a home-network key until this exact origin is allowed', () => {
    expect(() => checkKeyTransport('http://192.168.8.20:1234/api')).toThrow(/HTTP|unencrypted/i)
    allowHttpOrigin('http://192.168.8.20:1234')
    expect(allowedHttpOrigins()).toEqual(['http://192.168.8.20:1234'])
    expect(() => checkKeyTransport('http://192.168.8.20:1234/api')).not.toThrow()
    expect(() => checkKeyTransport('http://192.168.8.20:4321/api')).toThrow()
  })
  it('does not offer a public HTTP exception', () => {
    expect(() => allowHttpOrigin('http://api.sample.example')).toThrow(/home|local/i)
    expect(() => checkKeyTransport('http://api.sample.example')).toThrow()
  })
})
