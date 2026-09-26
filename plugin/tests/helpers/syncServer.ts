import {
  serverHarness,
  TEST_PASSWORD,
  type Harness,
} from '../../../../abele-sync/packages/core/tests/helpers/harness.js'
import { wsFor } from '../../../../abele-sync/packages/core/tests/helpers/serverFetch.js'

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

/**
 * The address the service is told to connect to. The harness's own `http://abele.test` is plain
 * http to another machine, which the plugin refuses; a server on this device is the one plain
 * http address it takes. The host is never resolved either way: every request is injected and
 * the socket is rebound to the app's port.
 */
const BASE_URL = 'http://localhost'

export interface SyncServer extends Harness {
  /** The base url the harness's clients are built with; only its shape matters. */
  BASE_URL: string
  /** The password `buildTestApp` gives every account it makes. */
  TEST_PASSWORD: string
  /**
   * A `WebSocket` bound to the app's own port, for a test that builds a client of its own.
   *
   * The harness keeps one to itself and does not hand it over; the plugin's service takes its
   * socket class as a dependency, so a test that gives it anything else would be watching a
   * host that never resolves.
   */
  WebSocket: typeof WebSocket
}

export async function syncServer(
  opts: Parameters<typeof serverHarness>[0] = {}
): Promise<SyncServer> {
  const harness = await serverHarness(opts)
  return { ...harness, BASE_URL, TEST_PASSWORD, WebSocket: await wsFor(harness.app) }
}
