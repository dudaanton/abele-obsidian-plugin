import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { verifySyncFixture } from '../../../scripts/verify-sync-inputs.mjs'
export function assertAgentStage(stage: string | undefined) {
  if (stage !== 'disposable') throw new Error('Agent stand stage must be explicitly disposable')
}
export function assertAgentCredential(token: string) {
  if (!/^absk_[A-Za-z0-9_-]{43}$/.test(token))
    throw new Error('Agent requires only a scoped machine credential')
}
export function requireAgentImageGate(step: string): never {
  throw new Error(
    'PENDING agent gate ' +
      step +
      ': reviewed sponsored/native HTTP API, owner hooks and native cache/paste evidence required'
  )
}
/** Entry script only. Every server module is imported unchanged from the verified archive. */
export function agentStandStartScript(root: string): string {
  if (!isAbsolute(root)) throw new Error('Verified archive requires an absolute root')
  const module = (file: string) =>
    JSON.stringify(pathToFileURL(join(root, 'packages/server/dist', file)).href)
  return `import {buildApp} from ${module('api/app.js')};import {createDb} from ${module('db/connect.js')};import {runMigrations} from ${module('db/migrate.js')};import {loadConfig} from ${module('config.js')};import {BlobStore} from ${module('blobs/store.js')};import {EventHub} from ${module('events/hub.js')};
 const config=loadConfig({...process.env,ABELE_SCOPED_SHARING:'off'}),h=createDb(config.databaseUrl);await runMigrations(h.db);const deps={config,db:h.db,dialect:h.dialect,store:new BlobStore(config.blobDir,config.masterKey),hub:new EventHub()};
 const closed=await buildApp(deps);const caps=(await closed.inject({method:'GET',url:'/v1/capabilities'})).json();const denial=await closed.inject({method:'GET',url:'/v1/vaults/sample/grants'});if(caps.scoped.enabled!==false||denial.statusCode!==503)throw new Error('Production default fence changed');await closed.close();
 const enabled=loadConfig({...process.env,ABELE_SCOPED_SHARING:'on'});const app=await buildApp({...deps,config:enabled});await app.listen({host:'127.0.0.1',port:0});enabled.publicUrl='http://127.0.0.1:'+app.server.address().port;const active=(await app.inject({method:'GET',url:'/v1/capabilities'})).json();if(active.scoped.enabled!==true||active.scoped.modes.group!==true)throw new Error('Deployment sharing capabilities unavailable');console.log(JSON.stringify({url:app.server.address().port,closedFence:true}));let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(stopping)return;stopping=true;void app.close().then(()=>h.close())});`
}
export function standPreparationPath(vaultId: string, grantId?: string): string {
  return (
    '/v1/vaults/' +
    encodeURIComponent(vaultId) +
    '/grants/' +
    (grantId ? encodeURIComponent(grantId) + '/prepare' : 'groups/prepare')
  )
}
function ended(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => child.once('exit', () => resolve()))
}
export async function spawnAgentStandServer(root: string, commit: string, work: string) {
  verifySyncFixture(root, commit)
  writeFileSync(join(work, 'start.mjs'), agentStandStartScript(root))
  const env = {
    ...process.env,
    ABELE_SCOPED_SHARING: 'on',
    ABELE_DATABASE_URL: 'sqlite://' + join(work, 'server.sqlite'),
    ABELE_BLOB_DIR: join(work, 'blobs'),
    ABELE_MASTER_KEY: randomBytes(32).toString('hex'),
    ABELE_TOKEN_PEPPER: randomBytes(16).toString('hex'),
  }
  const child = spawn(process.execPath, [join(work, 'start.mjs')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    try {
      await ended(child)
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Disposable agent server readiness failed')),
        30000
      )
      let output = ''
      child.stdout?.on('data', (b) => {
        output += String(b)
        try {
          const line = JSON.parse(output.trim())
          if (line.closedFence === true && Number.isInteger(line.url)) {
            clearTimeout(timer)
            resolve('http://127.0.0.1:' + line.url)
          }
        } catch {
          /* Readiness JSON may arrive in chunks. */
        }
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('Disposable agent server exited during readiness'))
      })
      child.stderr?.on('data', () => {})
    })
    const prepare = async (token: string, vaultId: string, grantId?: string) => {
      // Bounded pages, real fresh owner authority. Failure never repeats creation or renews a lease.
      for (let page = 0; page < 100; page++) {
        const res = await globalThis.fetch(url + standPreparationPath(vaultId, grantId), {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'x-abele-scoped-version': '4' },
        })
        if (!res.ok) throw new Error('Stand preparation refused: ' + res.status)
        const result = (await res.json()) as { state?: string; ready?: boolean }
        if (grantId ? result.state === 'active' : result.ready === true) return result
      }
      throw new Error('Stand preparation page bound reached')
    }
    return {
      url,
      stop,
      prepare: (token: string, vaultId: string, grantId: string) =>
        prepare(token, vaultId, grantId),
      prepareGroup: (token: string, vaultId: string) => prepare(token, vaultId),
      createAccount(email: string, password: string) {
        const done = spawnSync(
          process.execPath,
          [
            join(root, 'packages/server/dist/admin-cli/index.js'),
            'create-account',
            '--email',
            email,
            '--password',
            password,
          ],
          { env, encoding: 'utf8', timeout: 45000, killSignal: 'SIGKILL' }
        )
        if (done.status !== 0 || !done.stdout.includes('created account'))
          throw new Error('Disposable account creation failed')
      },
    }
  } catch (error) {
    await stop()
    throw error
  }
}
export function agentCommand(root: string, dir: string, args: string[], token?: string) {
  if (token) assertAgentCredential(token)
  const done = spawnSync(
    process.execPath,
    [join(root, 'packages/cli/dist/index.js'), 'agent', ...args, '--dir', dir],
    {
      env: { ...process.env, ...(token ? { ABELE_AGENT_TOKEN: token } : {}) },
      encoding: 'utf8',
      timeout: 45000,
      killSignal: 'SIGKILL',
    }
  )
  if (done.status !== 0)
    throw new Error(
      'Agent command refused: ' +
        args[0] +
        ' (exit ' +
        done.status +
        '): ' +
        done.stderr
          .replace(/(?:abst_|absd_|absi_|absk_)[A-Za-z0-9_-]+/g, '[redacted]')
          .slice(0, 300)
    )
  return done.stdout
}
