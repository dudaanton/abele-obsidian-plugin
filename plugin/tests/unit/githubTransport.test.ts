import { describe, it, expect, vi } from 'vitest'
import { nativeRequest, singleHopRequest } from '@/github/transport'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'

describe('single-hop GitHub native transport', () => {
  it('decodes HTTP gzip on desktop without confusing it with a gzip archive file', async () => {
    const body=Buffer.from('{"login":"sample-account"}')
    const server=createServer((req,res)=>{
      res.writeHead(200,req.url==='/file' ? {'Content-Type':'application/gzip'} : {'Content-Type':'application/json','Content-Encoding':'gzip'})
      res.end(gzipSync(body))
    })
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    try {
      const address=server.address() as {port:number}
      const r=await singleHopRequest({url:`http://127.0.0.1:${address.port}/api/v3/user`})
      expect(r.json).toEqual({login:'sample-account'})
      expect(new Uint8Array(r.arrayBuffer)).toEqual(new Uint8Array(body))
      const file=await singleHopRequest({url:`http://127.0.0.1:${address.port}/file`})
      expect(new Uint8Array(file.arrayBuffer)).toEqual(new Uint8Array(gzipSync(body)))
    } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())) }
  })

  it('accepts native JSON decoding when Content-Type overrides the requested arraybuffer response', async () => {
    const request = vi.fn(async () => ({ status: 200, headers: { 'Content-Type': 'application/json' }, data: { login: 'sample-account' } }))
    const r = await nativeRequest({ url: 'https://git.example.test/api/v3/user' }, { request })
    expect(r.json).toEqual({ login: 'sample-account' })
    expect(r.text).toBe('{"login":"sample-account"}')
  })

  it('disables automatic redirects and asks for base64 bytes on the native bridge', async () => {
    const request = vi.fn(async () => ({
      status: 302,
      headers: { Location: 'https://other.example.test/file' },
      data: 'eA==',
    }))
    const r = await nativeRequest(
      { url: 'https://git.example.test/api/v3/user', headers: { Authorization: 'Bearer fake' } },
      { request }
    )
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ disableRedirects: true, responseType: 'arraybuffer' })
    )
    expect(r.status).toBe(302)
    expect(new Uint8Array(r.arrayBuffer)).toEqual(new Uint8Array([120]))
  })
})
