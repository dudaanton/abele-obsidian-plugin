import { z } from 'zod'
import { assertPairedEndpoint } from '@abele/channel-protocol'

const LocalNodeSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().trim().min(1).max(128),
    url: z.string().refine((value) => {
      try {
        channelUrl(value)
        return true
      } catch {
        return false
      }
    }, 'Only an explicit loopback node URL is supported'),
    expectedNodeId: z.string().min(1).max(128),
  })
  .strict()
const PairedNodeSchema = z
  .object({
    id: z.string().min(1).max(128),
    label: z.string().trim().min(1).max(128),
    url: z.string().refine((url) => {
      try {
        assertPairedEndpoint(url)
        return true
      } catch {
        return false
      }
    }, 'Use a canonical Tailscale WSS endpoint'),
    expectedNodeId: z.string().min(1).max(128),
    profile: z.literal('paired-wss-v1'),
    installationId: z.string().min(1).max(128),
    nodeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    publicKey: z
      .object({
        kty: z.literal('EC'),
        crv: z.literal('P-256'),
        x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      })
      .strict(),
  })
  .strict()
const NodeSchema = z.union([LocalNodeSchema, PairedNodeSchema])
export type RegisteredNode = z.infer<typeof NodeSchema>
export type PairedNode = z.infer<typeof PairedNodeSchema>
export const isPairedNode = (node: RegisteredNode): node is PairedNode =>
  'profile' in node && node.profile === 'paired-wss-v1'

/** Do not let URL's hostname normalization turn aliases into the admitted address. */
export function channelUrl(url: string): string {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(url))
    throw new Error(
      'Use http://127.0.0.1:PORT for a local node; pair remote nodes with an invitation'
    )
  const parsed = new URL(url)
  if (!parsed.port || Number(parsed.port) < 1 || Number(parsed.port) > 65535)
    throw new Error('Invalid node port')
  return `ws://127.0.0.1:${parsed.port}/channel`
}

export interface RegistryHost {
  read(): unknown
  write(nodes: RegisteredNode[]): void
  getSecret(id: string): string
  setSecret(id: string, value: string): void
  removeSecret(id: string): void
}

/** Local preferences and independently revocable credentials, intentionally outside settings. */
export class NodeRegistry {
  private nodes: RegisteredNode[]
  constructor(private readonly host: RegistryHost) {
    this.nodes = z.array(NodeSchema).parse(host.read() ?? [])
  }
  list(): RegisteredNode[] {
    return this.nodes.map((node) => ({ ...node }))
  }
  token(id: string): string {
    return this.host.getSecret(this.keyId(id))
  }
  private keyId(id: string): string {
    return `abele-node-${id}`
  }
  add(raw: RegisteredNode, token: string): void {
    const node = NodeSchema.parse(raw)
    if (!token || token.length > 4096) throw new Error('Paste a node installation token')
    if (this.nodes.some((n) => n.id === node.id))
      throw new Error('Node installation already registered')
    this.host.setSecret(this.keyId(node.id), token)
    const next = [...this.nodes, node]
    try {
      this.host.write(next)
    } catch (error) {
      this.host.removeSecret(this.keyId(node.id))
      throw error
    }
    this.nodes = next
  }
  addPaired(raw: PairedNode): void {
    const node = PairedNodeSchema.parse(raw)
    const existing = this.nodes.find(
      (n) => n.expectedNodeId === node.expectedNodeId && isPairedNode(n)
    )
    if (existing && isPairedNode(existing) && existing.installationId !== node.installationId)
      throw new Error(
        'Installation changed; remove the old registration before enrolling a new device'
      )
    const next = existing
      ? this.nodes.map((n) => (n.id === existing.id ? { ...node, id: existing.id } : n))
      : [...this.nodes, node]
    this.host.write(next)
    this.nodes = next
  }
  remove(id: string): void {
    const next = this.nodes.filter((node) => node.id !== id)
    this.host.write(next)
    this.nodes = next
    this.host.removeSecret(this.keyId(id))
  }
}
