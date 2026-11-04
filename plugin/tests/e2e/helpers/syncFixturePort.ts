import { createServer } from 'node:net'
import { randomInt } from 'node:crypto'

/** The forwarded listener also binds on the phone. Avoid its dynamic client
 * ports; an outgoing connection there can otherwise make the reverse unbindable. */
export async function freeFixturePort(
  phone = false,
  first = randomInt(12000, 32768)
): Promise<number> {
  if (!Number.isSafeInteger(first) || first < 12000 || first >= 32768)
    throw new Error('Invalid fixture listener range')
  for (let attempt = 0; attempt < (phone ? 32 : 1); attempt++) {
    try {
      return await probePort(phone ? 12000 + ((first - 12000 + attempt) % (32768 - 12000)) : 0)
    } catch (error) {
      if (!phone || (error as { code?: string }).code !== 'EADDRINUSE') throw error
    }
  }
  throw new Error('No free phone fixture listener in the bounded range')
}

function probePort(candidate: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(candidate, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => (port ? resolve(port) : reject(new Error('No free fixture port'))))
    })
  })
}
