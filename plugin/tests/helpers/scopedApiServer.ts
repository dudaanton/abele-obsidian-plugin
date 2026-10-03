import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { verifySyncFixture } from '../../scripts/verify-sync-inputs.mjs'
const COMMIT = 'b5357cff918028e1e58b443ccc22eed0093eb689'
/** Separate server-only archive. Never aliases/pins this archive's unreviewed core push into plugin code. */
export async function scopedApiServer(options?: {
  root: string
  commit: string
  group?: boolean
  assets?: boolean
}) {
  const root = options?.root ?? process.env.ABELE_SCOPED_API_FIXTURE
  const expected = options?.commit ?? COMMIT
  if (!root) throw new Error('Explicit disposable scoped API archive is required')
  verifySyncFixture(root, expected)
  const provenance = JSON.parse(readFileSync(join(root, '.abele-sync-fixture.json'), 'utf8'))
  if (provenance.commit !== expected)
    throw new Error('Disposable scoped API archive revision mismatch')
  // Paths below are literal module names inside the exact checksum-verified archive.
  // eslint-disable-next-line no-unsanitized/method -- Only literal modules from the checksum-verified archive are imported.
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
  if (options?.assets) config.publicUrl = 'http://127.0.0.1'
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
  if (options?.group) {
    const { registerGroupManagementRoutes } = await load(
      'packages/server/dist/api/routes/groupManagement.js'
    )
    registerGroupManagementRoutes(management, {
      config,
      db: test.db,
      dialect: 'sqlite',
      store: test.store,
      hub: test.hub,
    })
  }
  if (options?.assets) {
    management.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer' },
      (_request: any, body: any, done: any) => done(null, body)
    )
    const deps = { config, db: test.db, dialect: 'sqlite', store: test.store, hub: test.hub }
    for (const [file, registration] of [
      ['sponsoredAssets', 'registerSponsoredAssetRoutes'],
      ['scopedUploads', 'registerScopedUploadRoutes'],
      ['scopedContent', 'registerScopedContentRoutes'],
      ['scopedState', 'registerScopedStateRoutes'],
      ['scopedViews', 'registerScopedViewRoutes'],
      ['scopedHistory', 'registerScopedHistoryRoutes'],
    ]) {
      const routes = await load('packages/server/dist/api/routes/' + file + '.js')
      routes[registration](management, deps)
    }
  }
  await management.ready()
  const fetchFor =
    (closed: boolean): typeof fetch =>
    async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      )
      const app =
        !closed &&
        (/^\/v1\/vaults\/[^/]+\/grants(?:\/|$)/.test(url.pathname) ||
          (options?.assets && /^\/v1\/scoped\/vaults\//.test(url.pathname)) ||
          (options?.group &&
            /^\/v1\/(?:invitations\/|scoped\/discovery|scoped\/grants\/)/.test(url.pathname)))
          ? management
          : test.app
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
    async prepareFolder(token: string, vaultId: string, grantId: string) {
      const { prepareFolderAdmissions } = await load(
        'packages/server/dist/scoped/folderPreparation.js'
      )
      return prepareFolderAdmissions(
        {
          db: test.db,
          dialect: 'sqlite',
          store: test.store,
          pepper: config.tokenPepper,
          accountTokenTtlMs: config.accountTokenTtlMs,
          configurationDirectories: config.configurationDirectories,
        },
        token,
        vaultId,
        grantId
      )
    },
    async prepareGroup(token: string, vaultId: string) {
      const { prepareGroupBootstrap } = await load(
          'packages/server/dist/scoped/groups/bootstrap.js'
        ),
        { processGroupDirtyPage } = await load('packages/server/dist/scoped/groups/worker.js'),
        deps = {
          db: test.db,
          dialect: 'sqlite',
          store: test.store,
          pepper: config.tokenPepper,
          accountTokenTtlMs: config.accountTokenTtlMs,
          configurationDirectories: config.configurationDirectories,
        }
      await prepareGroupBootstrap(deps, token, vaultId)
      await processGroupDirtyPage(deps, vaultId)
    },
    async intrinsicGeneration(grantId: string, fileId: string) {
      const row = await test.db
        .selectFrom('scope_current_members as member')
        .innerJoin('scope_admission_intervals as interval', 'interval.id', 'member.interval_id')
        .select('interval.generation')
        .where('member.grant_id', '=', grantId)
        .where('member.file_id', '=', fileId)
        .executeTakeFirst()
      return row?.generation
    },
    async close() {
      await management.close()
      await test.close()
    },
  }
}
