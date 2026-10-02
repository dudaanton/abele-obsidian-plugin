import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
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
/** ONLY an owned disposable test assembly. The unchanged production buildApp is checked closed
 * before this assembly listens. Contract advertisement does not claim extras/native implementation.
 */
export function assembleDisposableAgentApp(source: string) {
  for (const line of ['registerScopedFence(app);', 'registerCapabilityRoutes(app);'])
    if (source.split(line).length !== 2) throw new Error('Reviewed dormant server assembly changed')
  return source
    .replace(
      'registerScopedFence(app);',
      `/* disposable test fixture contract only; production activation unchanged */\napp.post('/__disposable/prepare',async(req,reply)=>{if(req.headers['x-disposable-owner']!==process.env.ABELE_DISPOSABLE_NONCE)return reply.code(403).send({error:'forbidden'});const b=req.body;return prepareFolderAdmissions({...deps,pepper:deps.config.tokenPepper,accountTokenTtlMs:deps.config.accountTokenTtlMs},b.token,b.vaultId,b.grantId)});`
    )
    .replace(
      'registerCapabilityRoutes(app);',
      `app.get('/v1/capabilities',async(_request,reply)=>reply.header('cache-control','no-store').send({protocol_version:1,device:true,scoped:{enabled:true,protocol_version:4,modes:{folder:true,group:false},features:Object.fromEntries(['common_read_profile','version_filtered_history','materialized_snapshots','grant_local_feed','authorized_merge','sponsored_extras','native_creates','script_policy','settings_exclusion'].map(k=>[k,true])),limits:{max_live_grants:64,max_operations:32,max_prepared_note_bytes:8388608,max_page_items:1000,max_snapshots:2,snapshot_lifetime_seconds:300}}}));`
    )
}
function imports(source: string, original: string, root: string) {
  const req = createRequire(join(root, 'packages/server/package.json'))
  return source.replace(
    /from ['"]([^'"]+)['"]/g,
    (_all, spec: string) =>
      'from ' +
      JSON.stringify(
        spec.startsWith('.')
          ? new URL(spec, pathToFileURL(original)).href
          : pathToFileURL(req.resolve(spec)).href
      )
  )
}
function ended(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => child.once('exit', () => resolve()))
}
export async function spawnAgentStandServer(root: string, commit: string, work: string) {
  verifySyncFixture(root, commit)
  const appPath = join(root, 'packages/server/dist/api/app.js'),
    appSource = readFileSync(appPath, 'utf8')
  writeFileSync(
    join(work, 'disposable-app.mjs'),
    `import {prepareFolderAdmissions} from ${JSON.stringify(pathToFileURL(join(root, 'packages/server/dist/scoped/admissions.js')).href)};\n` +
      imports(assembleDisposableAgentApp(appSource), appPath, root)
  )
  const module = (file: string) =>
    JSON.stringify(pathToFileURL(join(root, 'packages/server/dist', file)).href)
  // Real migrations/auth/blob/route services, no SQL row edits. Folder preparation is an explicit
  // fixture-only operator call because the dormant server has no production preparation worker.
  writeFileSync(
    join(work, 'start.mjs'),
    `import {buildApp as dormant} from ${module('api/app.js')};import {buildApp} from './disposable-app.mjs';import {createDb} from ${module('db/connect.js')};import {runMigrations} from ${module('db/migrate.js')};import {loadConfig} from ${module('config.js')};import {BlobStore} from ${module('blobs/store.js')};import {EventHub} from ${module('events/hub.js')};import {prepareFolderAdmissions} from ${module('scoped/admissions.js')};
 const config=loadConfig(process.env),h=createDb(config.databaseUrl);await runMigrations(h.db);const deps={config,db:h.db,dialect:h.dialect,store:new BlobStore(config.blobDir,config.masterKey),hub:new EventHub()};
 const closed=await dormant(deps);const caps=(await closed.inject({method:'GET',url:'/v1/capabilities'})).json();const denial=await closed.inject({method:'GET',url:'/v1/vaults/sample/grants'});if(caps.scoped.enabled!==false||denial.statusCode!==503)throw new Error('Production fence changed');await closed.close();
 const app=await buildApp(deps);await app.listen({host:'127.0.0.1',port:0});config.publicUrl='http://127.0.0.1:'+app.server.address().port;console.log(JSON.stringify({url:app.server.address().port,closedFence:true}));let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(stopping)return;stopping=true;void app.close().then(()=>h.close())});`
  )
  const nonce = randomBytes(32).toString('hex'),
    env = {
      ...process.env,
      ABELE_DATABASE_URL: 'sqlite://' + join(work, 'server.sqlite'),
      ABELE_BLOB_DIR: join(work, 'blobs'),
      ABELE_MASTER_KEY: randomBytes(32).toString('hex'),
      ABELE_TOKEN_PEPPER: randomBytes(16).toString('hex'),
      ABELE_DISPOSABLE_NONCE: nonce,
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
          /* Readiness JSON may be split across stdout chunks. */
        }
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('Disposable agent server exited during readiness'))
      })
      child.stderr?.on('data', () => {})
    })
    return {
      url,
      stop,
      async prepare(token: string, vaultId: string, grantId: string) {
        const res = await globalThis.fetch(url + '/__disposable/prepare', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-disposable-owner': nonce },
          body: JSON.stringify({ token, vaultId, grantId }),
        })
        if (!res.ok) {
          const body = (await res.json()) as { error?: { code?: string; message?: string } }
          throw new Error(
            'Disposable folder preparation failed: ' + res.status + ' ' + JSON.stringify(body.error)
          )
        }
        return res.json()
      },
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
  } catch (e) {
    await stop()
    throw e
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
