// What the Requests view and a request's tab do on a click: open, send, the menus of a row, the
// environment's dialog, new requests and collections. Obsidian's menus and dialogs over the model.
import { Menu, Notice, Platform } from 'obsidian'
import type { HttpEnvironmentEdit as EnvironmentEdit } from '@/components/debugger/http/types'
import { askName } from '@/modal/askName'
import { openComponentDialog } from '@/modal/componentDialog'
import { confirmAction } from '@/modal/confirm'
import { GlobalStore } from '@/stores/GlobalStore'
import { RequestsService, type RequestsContext } from './RequestsService'
import type { RequestsModel } from './RequestsModel'
import { toCurl } from './resolve'

export const REQUEST_TAB_VIEW = 'abele-request'

export const say = (e: unknown, fallback = 'The node did not answer') => {
  console.debug('[requests] Action failed', e)
  new Notice(e instanceof Error ? e.message : fallback)
}
export const app = () => GlobalStore.getInstance().app

export async function openRequestTab(context: RequestsContext, id: string) {
  const { workspace } = app()
  const state = { registrationId: context.registrationId, projectId: context.projectId, id }
  const existing = workspace.getLeavesOfType(REQUEST_TAB_VIEW).find((l) => {
    const s = (l.view as { getState(): Record<string, unknown> }).getState()
    return (
      s.registrationId === state.registrationId && s.projectId === state.projectId && s.id === id
    )
  })
  const leaf = existing ?? workspace.getLeaf('tab')
  await leaf.setViewState({ type: REQUEST_TAB_VIEW, state, active: true })
  await workspace.revealLeaf(leaf)
  // On a phone the request takes the screen: the drawer it was picked from closes.
  if (Platform.isPhone) workspace.leftSplit.collapse()
}

export function sendFromView(context: RequestsContext, id: string) {
  const model = RequestsService.instance().model(context)
  void model.send(id, { interactive: true }).catch((e) => say(e, 'Not sent'))
}

export async function copyCurl(model: RequestsModel, id: string) {
  const out = await model.prepared(id)
  await navigator.clipboard.writeText(toCurl(out))
  new Notice('Copied as curl, keys by name')
}

export async function rename(context: RequestsContext, id: string) {
  const model = RequestsService.instance().model(context)
  const doc = model.entry(id).doc ?? (await model.rpc.get(model.projectId, id))
  const name = await askName(app(), {
    title: 'Rename request',
    value: doc.name,
    submitText: 'Rename',
  })
  if (!name || name === doc.name) return
  const to = await model.rename(id, name)
  for (const leaf of app().workspace.getLeavesOfType(REQUEST_TAB_VIEW)) {
    const s = (leaf.view as { getState(): Record<string, unknown> }).getState()
    if (s.id === id && s.projectId === context.projectId)
      await leaf.setViewState({ type: REQUEST_TAB_VIEW, state: { ...s, id: to } })
  }
}

export async function remove(context: RequestsContext, id: string) {
  const model = RequestsService.instance().model(context)
  const name =
    model.state.collections.flatMap((c) => c.requests).find((r) => r.id === id)?.name ?? id
  const ok = await confirmAction(app(), {
    title: 'Delete request',
    message: `${name} goes, its file and its history of sends with it.`,
    confirmText: 'Delete',
  })
  if (!ok) return
  await model.remove(id)
  for (const leaf of app().workspace.getLeavesOfType(REQUEST_TAB_VIEW)) {
    const s = (leaf.view as { getState(): Record<string, unknown> }).getState()
    if (s.id === id && s.projectId === context.projectId) leaf.detach()
  }
}

export function requestMenu(context: RequestsContext, id: string, event: MouseEvent) {
  const model = RequestsService.instance().model(context)
  const menu = new Menu()
  menu.addItem((i) =>
    i
      .setTitle('Send')
      .setIcon('send-horizontal')
      .onClick(() => {
        void openRequestTab(context, id).then(() => sendFromView(context, id))
      })
  )
  menu.addItem((i) =>
    i
      .setTitle('Duplicate')
      .setIcon('copy-plus')
      .onClick(() => {
        void model
          .duplicate(id)
          .then((copy) => openRequestTab(context, copy))
          .catch(say)
      })
  )
  menu.addItem((i) =>
    i
      .setTitle('Rename')
      .setIcon('pencil')
      .onClick(() => void rename(context, id).catch(say))
  )
  menu.addItem((i) =>
    i
      .setTitle('Copy as curl')
      .setIcon('terminal')
      .onClick(() => void copyCurl(model, id).catch(say))
  )
  menu.addSeparator()
  menu.addItem((i) =>
    i
      .setTitle('Delete')
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => void remove(context, id).catch(say))
  )
  menu.showAtMouseEvent(event)
}

export function editEnvironment(model: RequestsModel) {
  const env = model.state.env
  if (!env) return
  const dialog = openComponentDialog(
    async () => (await import('@/components/debugger/http/EnvironmentDialog.vue')).default,
    {
      environment: {
        name: env.name,
        vars: env.vars,
        stepHeader: !!env.step_header,
      } satisfies EnvironmentEdit,
      secrets: model.secrets(),
      onSave: (edit: EnvironmentEdit) => {
        void model
          .saveEnvironment({
            name: edit.name,
            vars: edit.vars,
            ...(edit.stepHeader ? { step_header: true } : {}),
          })
          .then(() => dialog.close())
          .catch(say)
      },
      onRemove: () => {
        void model
          .removeEnvironment(env.name)
          .then(() => dialog.close())
          .catch(say)
      },
    },
    { key: 'abele-requests-environment' }
  )
}

export function environmentMenu(model: RequestsModel, event: MouseEvent) {
  const menu = new Menu()
  for (const name of model.state.environments)
    menu.addItem((i) =>
      i
        .setTitle(name)
        .setChecked(name === model.state.environment)
        .onClick(() => void model.selectEnvironment(name).catch(say))
    )
  if (model.state.environments.length) menu.addSeparator()
  menu.addItem((i) =>
    i
      .setTitle('Edit environment')
      .setIcon('pencil')
      .setDisabled(!model.state.env)
      .onClick(() => editEnvironment(model))
  )
  menu.addItem((i) =>
    i
      .setTitle('New environment')
      .setIcon('plus')
      .onClick(() => {
        void askName(app(), {
          title: 'New environment',
          placeholder: 'local',
          submitText: 'Create',
        })
          .then((name) => (name ? model.createEnvironment(name) : undefined))
          .catch(say)
      })
  )
  menu.showAtMouseEvent(event)
}

export async function projectMenu(event: MouseEvent) {
  const service = RequestsService.instance()
  const menu = new Menu()
  const contexts = await service.contexts().catch((): RequestsContext[] => [])
  if (!contexts.length)
    menu.addItem((i) => i.setTitle('No connected node keeps saved requests').setDisabled(true))
  for (const c of contexts)
    menu.addItem((i) =>
      i
        .setTitle(c.node ? `${c.label} · ${c.node}` : (c.label ?? c.projectId))
        .setChecked(
          service.context.value?.projectId === c.projectId &&
            service.context.value.registrationId === c.registrationId
        )
        .onClick(() => service.choose(c))
    )
  menu.showAtMouseEvent(event)
}

export async function newRequest(context: RequestsContext) {
  const model = RequestsService.instance().model(context)
  const name = await askName(app(), {
    title: 'New request',
    placeholder: 'Create order',
    submitText: 'Create',
  })
  if (!name) return
  const open = RequestsService.instance().openRequest.value
  const collection =
    (open && open.projectId === context.projectId && open.id.includes('/')
      ? open.id.slice(0, open.id.lastIndexOf('/'))
      : undefined) ??
    model.state.collections[0]?.name ??
    'Requests'
  const id = await model.create(collection, name)
  await openRequestTab(context, id)
}

export async function newCollection(context: RequestsContext) {
  const name = await askName(app(), {
    title: 'New collection',
    placeholder: 'Orders',
    submitText: 'Create',
  })
  if (name) await RequestsService.instance().model(context).createCollection(name)
}

/** Brings a request into sight in the Requests view: its project shown, its collection unfolded. */
export async function revealRequest(context: RequestsContext, id: string) {
  const service = RequestsService.instance()
  const shown = service.context.value
  if (shown?.registrationId !== context.registrationId || shown.projectId !== context.projectId)
    service.choose({ registrationId: context.registrationId, projectId: context.projectId })
  service.openRequest.value = { ...context, id }
  const { openRequestsView } = await import('./views')
  await openRequestsView(app())
  service.reveal.value = {
    collection: id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : 'Requests',
    ids: [id],
    at: Date.now(),
  }
}
