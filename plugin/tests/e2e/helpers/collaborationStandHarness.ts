import { assembleDisposableAgentApp, spawnAgentStandServer } from './agentStandHarness'
/** Test-only group assembly: real archived worker/services, not injected membership rows. */
export function assembleDisposableCollaborationApp(source: string) {
  return assembleDisposableAgentApp(source)
    .replace('group:false', 'group:true')
    .replace(
      "app.post('/__disposable/prepare'",
      `const groupVaults=new Set();let groupBusy=false;const groupDeps={...deps,pepper:deps.config.tokenPepper,accountTokenTtlMs:deps.config.accountTokenTtlMs};const groupTimer=setInterval(async()=>{if(groupBusy)return;groupBusy=true;try{for(const vault of groupVaults)await processGroupDirtyPage(groupDeps,vault)}finally{groupBusy=false}},500);app.addHook('onClose',async()=>{clearInterval(groupTimer)});app.post('/__disposable/prepare-group',async(req,reply)=>{if(req.headers['x-disposable-owner']!==process.env.ABELE_DISPOSABLE_NONCE)return reply.code(403).send({error:'forbidden'});const b=req.body;await prepareGroupBootstrap(groupDeps,b.token,b.vaultId);await processGroupDirtyPage(groupDeps,b.vaultId);groupVaults.add(b.vaultId);return{prepared:true}});app.post('/__disposable/prepare'`
    )
}
export const spawnCollaborationStandServer = (root: string, commit: string, work: string) =>
  spawnAgentStandServer(root, commit, work, {
    assembly: assembleDisposableCollaborationApp,
    extraImports: ['scoped/groups/bootstrap.js', 'scoped/groups/worker.js'],
  })
