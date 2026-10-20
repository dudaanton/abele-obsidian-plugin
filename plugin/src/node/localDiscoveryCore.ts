import { DeviceNameSchema } from '@abele/channel-protocol'

/** Minimal native filesystem/IPC bridge. Supply it only on an owner-controlled desktop.
 * The SDK neither imports Node nor loads a product shell's runtime itself. */
interface NativeStat {
  dev: number
  ino: number
  uid: number
  mode: number
  mtimeMs: number
  size: number
  isDirectory(): boolean
  isFile(): boolean
  isSocket(): boolean
  isSymbolicLink(): boolean
}
interface IpcSocket {
  destroy(): unknown
  end(data: string): unknown
  setTimeout(milliseconds: number, callback: () => void): unknown
  on(event: 'data', callback: (chunk: { toString(): string }) => void): unknown
  on(event: 'connect' | 'error' | 'end' | 'close', callback: () => void): unknown
}
export interface DesktopRuntime {
  fs: {
    lstatSync(path: string): NativeStat
    fstatSync(fd: number): NativeStat
    openSync(path: string, flags: number): number
    closeSync(fd: number): void
    readFileSync(fd: number, encoding: 'utf8'): string
    constants: { O_RDONLY: number; O_NOFOLLOW: number }
  }
  net: { createConnection(endpoint: string): IpcSocket }
  os: { homedir(): string }
  path: {
    resolve(path: string): string
    parse(path: string): { root: string }
    sep: string
    join(...paths: string[]): string
    isAbsolute(path: string): boolean
    dirname(path: string): string
  }
  process: { getuid?: () => number; kill(pid: number, signal: 0): unknown }
}
export interface LocalNode {
  nodeName: string
  nodeId: string
  endpoint: string
  nodeVersion?: string
}
interface Identity {
  dev: number
  ino: number
  uid: number
  mode: number
  mtimeMs: number
  size: number
}
interface Snapshot {
  stateDir: string
  socket: string
  node: LocalNode
  lockIdentity: Identity
  socketIdentity: Identity
  directoryIdentity: Identity
}
/** add must pass expectedNodeId into NodeClient's authenticated handshake BEFORE persisting registration.
 * Its token adapter MUST be device-local (never synced settings, notes or exports). */
export interface LocalRegistration<T extends { expectedNodeId: string }> {
  add(label: string, endpoint: string, token: string, expectedNodeId: string): Promise<T>
}
const identity = (stat: NativeStat): Identity => ({
  dev: stat.dev,
  ino: stat.ino,
  uid: stat.uid,
  mode: stat.mode,
  mtimeMs: stat.mtimeMs,
  size: stat.size,
})
const same = (a: Identity, b: Identity) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.uid === b.uid &&
  a.mode === b.mode &&
  a.mtimeMs === b.mtimeMs &&
  a.size === b.size

/** Lazy desktop adapter. No port scanning, SQLite, credentials in discovery results, or LAN fallback. */
export class LocalDiscovery {
  private handles = new WeakMap<LocalNode, Snapshot>()
  constructor(
    private readonly desktop: boolean,
    private readonly load: () => DesktopRuntime
  ) {}
  private inspect(runtime: DesktopRuntime, stateDir: string): Snapshot {
    const { fs, path, process } = runtime
    const uid = process.getuid?.()
    if (uid === undefined || path.resolve(stateDir) !== stateDir)
      throw new Error('unprotected_local_runtime')
    const inspectPath = (name: string, kind: 'file' | 'directory' | 'socket') => {
      if (!path.isAbsolute(name) || path.resolve(name) !== name)
        throw new Error('unprotected_local_runtime')
      // Never follow a symlink, including an ancestor. Writable ancestors require sticky protection.
      let prefix = path.parse(name).root
      const parts = name.slice(prefix.length).split(path.sep).filter(Boolean)
      for (let i = 0; i < parts.length; i++) {
        prefix = path.join(prefix, parts[i]!)
        const stat = fs.lstatSync(prefix)
        if (stat.isSymbolicLink()) throw new Error('unprotected_local_runtime')
        if (i < parts.length - 1) {
          if (!stat.isDirectory() || ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0))
            throw new Error('unprotected_local_runtime')
        } else {
          if (
            stat.uid !== uid ||
            (stat.mode & 0o077) !== 0 ||
            !(kind === 'file'
              ? stat.isFile()
              : kind === 'socket'
                ? stat.isSocket()
                : stat.isDirectory())
          )
            throw new Error('unprotected_local_runtime')
          return identity(stat)
        }
      }
      throw new Error('unprotected_local_runtime')
    }
    const directoryIdentity = inspectPath(stateDir, 'directory')
    const lockPath = path.join(stateDir, 'daemon.lock')
    const lockIdentity = inspectPath(lockPath, 'file')
    const fd = fs.openSync(lockPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    let raw: unknown
    try {
      const opened = fs.fstatSync(fd)
      if (!same(lockIdentity, identity(opened)) || opened.size > 65536)
        throw new Error('unprotected_local_runtime')
      raw = JSON.parse(fs.readFileSync(fd, 'utf8'))
    } finally {
      fs.closeSync(fd)
    }
    if (!raw || typeof raw !== 'object') throw new Error('invalid_local_runtime')
    const value = raw as Record<string, unknown>
    if (
      !Number.isSafeInteger(value.pid) ||
      Number(value.pid) < 1 ||
      !Number.isInteger(value.port) ||
      Number(value.port) < 1 ||
      Number(value.port) > 65535 ||
      typeof value.node_id !== 'string' ||
      !value.node_id ||
      value.node_id.length > 128 ||
      typeof value.control_socket !== 'string'
    )
      throw new Error('invalid_local_runtime')
    process.kill(Number(value.pid), 0)
    inspectPath(path.dirname(value.control_socket), 'directory')
    const socketIdentity = inspectPath(value.control_socket, 'socket')
    if (
      !same(lockIdentity, inspectPath(lockPath, 'file')) ||
      !same(directoryIdentity, inspectPath(stateDir, 'directory'))
    )
      throw new Error('local_discovery_stale')
    const nodeName =
      typeof value.node_name === 'string' ? DeviceNameSchema.parse(value.node_name) : 'Local node'
    return {
      stateDir,
      socket: value.control_socket,
      node: {
        nodeName,
        nodeId: value.node_id,
        endpoint: `ws://127.0.0.1:${Number(value.port)}/channel`,
        ...(typeof value.node_version === 'string' ? { nodeVersion: value.node_version } : {}),
      },
      lockIdentity,
      socketIdentity,
      directoryIdentity,
    }
  }
  discover(stateDir?: string): LocalNode | undefined {
    if (!this.desktop) return undefined
    try {
      const runtime = this.load()
      const snapshot = this.inspect(
        runtime,
        stateDir ?? runtime.path.join(runtime.os.homedir(), '.local', 'state', 'abele-node')
      )
      this.handles.set(snapshot.node, snapshot)
      return snapshot.node
    } catch {
      return undefined
    }
  }
  private recheck(runtime: DesktopRuntime, before: Snapshot) {
    const after = this.inspect(runtime, before.stateDir)
    if (
      !same(before.lockIdentity, after.lockIdentity) ||
      !same(before.socketIdentity, after.socketIdentity) ||
      !same(before.directoryIdentity, after.directoryIdentity) ||
      before.socket !== after.socket ||
      before.node.nodeId !== after.node.nodeId ||
      before.node.endpoint !== after.node.endpoint
    )
      throw new Error('local_discovery_stale')
  }
  async connect<T extends { expectedNodeId: string }>(
    node: LocalNode,
    deviceName: string,
    registration: LocalRegistration<T>,
    signal?: AbortSignal
  ): Promise<T> {
    const snapshot = this.handles.get(node)
    if (!this.desktop || !snapshot) throw new Error('local_discovery_stale')
    DeviceNameSchema.parse(deviceName)
    const runtime = this.load()
    try {
      this.recheck(runtime, snapshot)
    } catch {
      throw new Error('local_discovery_stale')
    }
    if (signal?.aborted) throw new Error('local_discovery_cancelled')
    const result = await new Promise<unknown>((resolve, reject) => {
      const socket = runtime.net.createConnection(snapshot.socket)
      let data = '',
        settled = false
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        socket.destroy()
        if (error) reject(error)
        else resolve(value)
      }
      const abort = () => finish(new Error('local_discovery_cancelled'))
      signal?.addEventListener('abort', abort, { once: true })
      socket.setTimeout(3000, () => finish(new Error('local_control_timeout')))
      socket.on('error', () => finish(new Error('local_control_failed')))
      socket.on('connect', () => {
        try {
          this.recheck(runtime, snapshot)
          socket.end(JSON.stringify({ action: 'create', value: deviceName }) + '\n')
        } catch {
          finish(new Error('local_discovery_stale'))
        }
      })
      socket.on('data', (chunk) => {
        data += chunk.toString()
        if (data.length > 65536) finish(new Error('local_control_failed'))
      })
      socket.on('end', () => {
        try {
          const response = JSON.parse(data) as { error?: unknown; result?: unknown }
          if (response.error) throw new Error('local_control_failed')
          finish(undefined, response.result)
        } catch {
          finish(new Error('local_control_failed'))
        }
      })
      socket.on('close', () => {
        if (!settled) finish(new Error('local_control_failed'))
      })
    })
    try {
      this.recheck(runtime, snapshot)
    } catch {
      throw new Error('local_discovery_stale')
    }
    if (signal?.aborted) throw new Error('local_discovery_cancelled')
    const credentials = result as { token?: unknown; installation_id?: unknown } | undefined
    if (
      !credentials ||
      typeof credentials.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(credentials.token) ||
      typeof credentials.installation_id !== 'string' ||
      !credentials.installation_id ||
      credentials.installation_id.length > 128
    )
      throw new Error('local_control_failed')
    // Return no token and retain no token/path in UI metadata. add owns the local secret store.
    const registered = await registration.add(
      snapshot.node.nodeName,
      snapshot.node.endpoint,
      credentials.token,
      snapshot.node.nodeId
    )
    if (registered.expectedNodeId !== snapshot.node.nodeId)
      throw new Error('node_identity_mismatch')
    return registered
  }
}
