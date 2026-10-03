import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
export interface CollaborationPeer {
  dir: string
  token: string
  vaultId: string
  grantId?: string
  principalId?: string
  facet: 'personal' | 'installation'
}
/** Owned fixture runtime: actual archived CLI NodeFileSystem/SQLite and core. Not a new
 * production CLI mode, Android host, or native collaborator UI. Secrets travel on stdin. */
export function writeCollaborationPeerProgram(root: string, work: string) {
  const file = join(work, 'collaboration-peer.mjs'),
    url = (path: string) => JSON.stringify(pathToFileURL(join(root, path)).href)
  writeFileSync(
    file,
    `import {readFileSync} from 'node:fs';import {join} from 'node:path';import {NodeFileSystem} from ${url('packages/cli/dist/nodeFs.js')};import {SqliteStateStore} from ${url('packages/cli/dist/sqliteState.js')};import {acquireLock} from ${url('packages/cli/dist/lock.js')};import {SyncClient,SyncEngine,selectiveDefaults,createScopedClient,ScopedState,pullScoped,pushScoped,scanScopedChanges} from ${url('packages/core/dist/index.js')};const input=JSON.parse(readFileSync(0,'utf8')),lock=await acquireLock(input.dir),raw=SqliteStateStore.open(join(input.dir,'.abele-sync','fixture.sqlite')),fs=new NodeFileSystem(input.dir,{skipHidden:true});let engine;try{if(input.facet==='personal'){if(!input.token.startsWith('absd_'))throw new Error('Personal facet mismatch');const client=new SyncClient({baseUrl:input.url,fetch:globalThis.fetch,token:input.token}).forVault(input.vaultId);engine=new SyncEngine({client,fs,state:raw,selective:selectiveDefaults(),stillHeld:lock.held});const result=await engine.sync();console.log(JSON.stringify({facet:'personal',state:engine.status.state,pending:engine.status.pending??0,result}));}else{if(!input.token.startsWith('absi_'))throw new Error('Installation facet mismatch');const client=await createScopedClient({baseUrl:input.url,fetch:globalThis.fetch,token:input.token,vaultId:input.vaultId,grantId:input.grantId,principalId:input.principalId,principalKind:'installation'}),remote=await client.negotiate();if(remote.state.selector.kind!=='group')throw new Error('Group selector required');const state=await ScopedState.open(raw,client.binding,{initialize:input.action==='init'});let result;if(input.action==='push')result=await pushScoped({client,state,fs,ops:await scanScopedChanges(fs,state,'__fixture_no_untracked__/'),stillHeld:lock.held});else result=await pullScoped({client,state,fs,stillHeld:lock.held});const known=await state.knownPage(0);console.log(JSON.stringify({facet:'installation',result,known:known.map(f=>({path:f.path,fileId:f.file_id,versionId:f.version_id,state:f.state,native:f.native??false}))}));}}catch(error){console.error(JSON.stringify({fixtureError:{code:error.code??null,message:error.message}}));process.exitCode=1}finally{await engine?.stop();raw.close();lock();}`
  )
  return file
}
export function runCollaborationPeer(
  program: string,
  url: string,
  peer: CollaborationPeer,
  action: 'init' | 'pull' | 'push' = 'pull'
) {
  mkdirSync(join(peer.dir, '.abele-sync'), { recursive: true })
  const r = spawnSync(process.execPath, [program], {
    input: JSON.stringify({ ...peer, url, action }),
    encoding: 'utf8',
    timeout: 45000,
    killSignal: 'SIGKILL',
  })
  if (r.status !== 0) {
    let code: string | undefined
    try {
      code = JSON.parse(r.stderr.trim()).fixtureError?.code
    } catch {
      /* nonprotocol process failure */
    }
    throw Object.assign(
      new Error(
        'Collaboration peer refused: ' +
          String(r.status) +
          ' ' +
          r.stderr
            .replace(/(?:abst_|absd_|absi_|absk_)[A-Za-z0-9_-]+/g, '[redacted]')
            .slice(0, 1200)
      ),
      { code }
    )
  }
  return JSON.parse(r.stdout.trim())
}
