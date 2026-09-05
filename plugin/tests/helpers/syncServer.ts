import {
  serverHarness,
  BASE_URL,
  TEST_PASSWORD,
  type Harness,
} from '../../../../abele-sync/packages/core/tests/helpers/harness.js'

/**
 * The real sync server, in this process, for the plugin's integration tests.
 *
 * The engine's own tests already run against a whole Fastify app on an in-memory database and
 * a temporary blob directory, with a `fetch` that goes through `app.inject` and a real `ws` on
 * a free port. This is that harness and nothing more: a second copy would be a second thing to
 * keep true to the server. The sibling repo is read from its sources, through the two aliases
 * in `vitest.config.ts` that mirror the core's own config.
 *
 * Because the server is Node — better-sqlite3, `node:fs`, Fastify — **every test file that
 * calls this must start with `// @vitest-environment node`.** The plugin's default environment
 * is happy-dom, and the server will not load in it.
 */
export type { Harness }

export interface SyncServer extends Harness {
  /** The base url the harness's clients are built with; only its shape matters. */
  BASE_URL: string
  /** The password `buildTestApp` gives every account it makes. */
  TEST_PASSWORD: string
}

export async function syncServer(
  opts: Parameters<typeof serverHarness>[0] = {}
): Promise<SyncServer> {
  const harness = await serverHarness(opts)
  return { ...harness, BASE_URL, TEST_PASSWORD }
}
