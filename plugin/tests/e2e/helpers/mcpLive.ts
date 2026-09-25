/**
 * Starts the MCP test server in a child process and reads what it was asked.
 * See `mcpServerMain.ts` for why it cannot run inside the test worker.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSync } from 'esbuild'

export interface LiveMcpServer {
  url: string
  requests(): { method: string | null; origin: string | null; userAgent: string | null }[]
  stop(): void
}

export async function startLiveMcpServer(
  mode: 'modern' | 'legacy',
  sse = false
): Promise<LiveMcpServer> {
  const dir = mkdtempSync(join(tmpdir(), 'abele-mcp-'))
  const bundle = join(dir, 'server.mjs')
  buildSync({
    entryPoints: [join(__dirname, 'mcpServerMain.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    logLevel: 'silent',
  })
  const child: ChildProcess = spawn(process.execPath, [bundle, mode, ...(sse ? ['sse'] : [])], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const lines: string[] = []
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the MCP test server did not start')), 15_000)
    child.stdout!.on('data', (chunk: Buffer) => {
      lines.push(...chunk.toString().split('\n'))
      const found = lines.map((l) => /^listening (\S+)/.exec(l)).find(Boolean)
      if (found) {
        clearTimeout(timer)
        resolve(found[1])
      }
    })
    child.on('exit', (code) => reject(new Error(`the MCP test server exited with ${code}`)))
  })
  return {
    url,
    requests: () =>
      lines
        .filter((l) => l.startsWith('REQ '))
        .map((l) => JSON.parse(l.slice(4)) as ReturnType<LiveMcpServer['requests']>[number]),
    stop: () => {
      child.kill()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
