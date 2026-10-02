import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const COMMIT = '9b1136a0554287def69afb79b56eaaffcb09ca00'
/** Separate server-only archive. Never aliases/pins this archive's unreviewed core push into plugin code. */
export async function scopedApiServer() {
  const root = process.env.ABELE_SCOPED_API_FIXTURE
  if (!root) throw new Error('Explicit disposable scoped API archive is required')
  const provenance = JSON.parse(readFileSync(join(root, '.abele-sync-fixture.json'), 'utf8'))
  if (provenance.commit !== COMMIT)
    throw new Error('Disposable scoped API archive revision mismatch')
  const load = (file: string) => import(/* @vite-ignore */ pathToFileURL(join(root, file)).href)
  const { buildTestApp } = await load('packages/server/tests/helpers/testApp.ts')
  const test = await buildTestApp()
  const { default: Fastify } = await load('node_modules/fastify/fastify.js')
  const management = Fastify({ logger: false })
  const { registerFolderGrantRoutes } = await load(
    'packages/server/dist/api/routes/folderGrants.js'
  )
  const { errorHandler, notFoundHandler } = await load('packages/server/dist/api/errors.js')
  const { loadConfig } = await load('packages/server/dist/config.js')
  const config = loadConfig({
    ABELE_MASTER_KEY: 'ab'.repeat(32),
    ABELE_TOKEN_PEPPER: 'test',
    ABELE_BLOB_DIR: join(test.dir, 'blobs'),
  })
  management.setErrorHandler(errorHandler)
  management.setNotFoundHandler(notFoundHandler)
  // ONLY this injected disposable app omits the early activation hook. Real route/services/auth
  // are unchanged; the original buildApp remains available for closed-fence assertions.
  registerFolderGrantRoutes(management, {
    config,
    db: test.db,
    dialect: 'sqlite',
    store: test.store,
    hub: test.hub,
  })
  await management.ready()
  const fetchFor =
    (closed: boolean): typeof fetch =>
    async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      )
      const app =
        !closed && /^\/v1\/vaults\/[^/]+\/grants(?:\/|$)/.test(url.pathname) ? management : test.app
      const headers = Object.fromEntries(new Headers(init?.headers).entries())
      const answer = await app.inject({
        method: init?.method ?? 'GET',
        url: url.pathname + url.search,
        headers,
        payload:
          init?.body instanceof ArrayBuffer
            ? Buffer.from(init.body)
            : ArrayBuffer.isView(init?.body)
              ? Buffer.from(init.body.buffer, init.body.byteOffset, init.body.byteLength)
              : (init?.body as string | undefined),
      })
      const status = answer.statusCode,
        body =
          init?.method === 'HEAD' || [204, 205, 304].includes(status) ? null : answer.rawPayload
      return new Response(body, { status, headers: answer.headers as Record<string, string> })
    }
  return {
    ...test,
    fetch: fetchFor(false),
    closedFetch: fetchFor(true),
    async close() {
      await management.close()
      await test.close()
    },
  }
}
