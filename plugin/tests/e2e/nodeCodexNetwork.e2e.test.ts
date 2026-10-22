import { expect, it } from 'vitest'
import { evalAsync } from './helpers/githubLive'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { NODE_PANEL_FIXTURE } from './helpers/nodePanelFixture'

targets('desktop')
const shots = shotDir('abele-codex-network')
const inspect = (device: string) =>
  evalAsync<Record<string, boolean>>(`(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async (fn, state) => { for(let i=0;i<160;i++){if(fn())return;await wait(50)}throw Error('Network control did not settle: ' + state) }
  const capture = async name => {
    await until(() => ![...document.querySelectorAll('.notice')].some(el => el.getBoundingClientRect().height > 0), 'notices before ' + name)
    await wait(300)
    require('fs').writeFileSync(${JSON.stringify(shots)} + '/' + ${JSON.stringify(device)} + '-' + name + '.png', (await require('@electron/remote').getCurrentWindow().webContents.capturePage()).toPNG())
  }
  ${NODE_PANEL_FIXTURE}
  const seen = {}
  nodePanel.variant.codexNetwork = true
  const item = menu => [...menu.querySelectorAll('.menu-item')].find(i => i.querySelector('.menu-item-title')?.textContent.trim() === 'Network for Codex')
  const checked = item => item.classList.contains('mod-checked') || !!item.querySelector('.menu-item-icon.mod-checked,.mod-checked')
  const closeCard = async () => {
    const container = document.querySelector('.abele-node-delegation')?.closest('.modal-container')
    const close = [...(container?.querySelectorAll('.modal-header-button,.modal-close-button') ?? [])].find(el => el.getBoundingClientRect().width > 0)
    if (!close) throw Error('Visible dialog close button missing')
    close.click()
    await until(() => !document.querySelector('.abele-node-delegation'), 'close dialog')
  }
  try {
    const panel = await nodePanel.open('feature')
    const state = window.__abeleNodePanelFixture
    const connection = state.nodes.connection(state.registration.id)
    let menu = await nodePanel.menu()
    seen.off = !!item(menu) && !checked(item(menu))
    await capture('menu-off')
    item(menu).click()
    await until(() => panel.querySelector('.abele-node-place [data-icon="globe"], .abele-node-place .lucide-globe'), 'place globe')
    await capture('row-globe')
    menu = await nodePanel.menu()
    seen.on = checked(item(menu))
    await capture('menu-on')
    item(menu).click()
    await wait(150)
    await window.__abeleTest.openDialog('node-delegation-card', { codexNetworkRefusal: { nodeId: state.registration.id, projectId: 'sample-repository-project' } })
    await until(() => document.querySelector('[data-codex-network-refusal] button'), 'refusal action')
    seen.refusal = document.querySelector('[data-codex-network-refusal]').textContent.includes('Network is off for Codex')
    await capture('refusal-before')
    document.querySelector('[data-codex-network-refusal] button').click()
    await until(() => document.querySelector('[data-codex-network-refusal]').textContent.includes('Network is on. Ask the agent to try again.'), 'enabled guidance')
    seen.enabled = !document.querySelector('[data-codex-network-refusal] button')
    await capture('refusal-after')
    await closeCard()
    await window.__abeleTest.openDialog('node-delegation-card', { codexNetworkRefusal: { nodeId: 'sample-unowned-node', projectId: 'sample-repository-project' } })
    await until(() => document.querySelector('[data-codex-network-refusal]'), 'non-owner guidance')
    seen.nonOwner = document.querySelector('[data-codex-network-refusal]').textContent.includes('Only the node’s owner') && !document.querySelector('[data-codex-network-refusal] button')
    await capture('not-owner')
    await closeCard()
    connection.state.value = 'offline'
    menu = await nodePanel.menu()
    seen.offline = item(menu).classList.contains('is-disabled')
    await capture('node-offline')
    return seen
  } finally {
    if(document.querySelector('.abele-node-delegation')) await closeCard()
    await nodePanel.close()
  }
})()`)

it.each(['desktop', 'phone'])(
  'offers project network controls on %s without running a provider',
  async (device) => {
    const result =
      device === 'phone' ? await withEmulatedPhone(() => inspect(device)) : inspect(device)
    expect(result).toEqual({
      off: true,
      on: true,
      refusal: true,
      enabled: true,
      nonOwner: true,
      offline: true,
    })
  }
)
