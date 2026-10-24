import { computed, provide, watch, type ComputedRef } from 'vue'
import type { NodeRepositoryTarget } from '@/repository/nodeLinks'
import { WORKING_TREE } from '@/repository/node'
import { RequestsService } from './RequestsService'
import { NodeRequestFiles } from './nodeFiles'
import { FILE_LENS } from './fileLens'
import { openRequestTab, say, sendFromView } from './actions'

/** Current files keep their exact worktree; historical versions never send live code. */
export function useFileRequests(
  target: ComputedRef<NodeRepositoryTarget | null>,
  onOpenRequest?: () => void
) {
  const context = computed(() => {
    const identity = target.value?.source
    if (identity?.provider !== 'node') return undefined
    const base = { registrationId: identity.node, projectId: identity.project }
    const root = RequestsService.instance().model(base).files?.port
    return root instanceof NodeRequestFiles && root.matches(identity.workspace)
      ? base
      : { ...base, worktreeId: identity.workspace }
  })
  const model = computed(() =>
    context.value ? RequestsService.instance().model(context.value) : undefined
  )
  watch(
    model,
    (model, _previous, cleanup) => {
      if (!model) return
      cleanup(model.followFiles())
      void model.refreshFiles().catch((e) => console.debug('[requests] File lenses unavailable', e))
    },
    { immediate: true }
  )
  const current = computed(() => {
    const at = target.value
    const port = model.value?.files?.port
    return (
      !!at &&
      at.source.provider === 'node' &&
      at.location.kind === 'file' &&
      at.location.ref === WORKING_TREE &&
      port instanceof NodeRequestFiles &&
      port.matches(at.source.workspace)
    )
  })
  provide(FILE_LENS, (path) =>
    computed(() => {
      const m = model.value,
        c = context.value
      if (!m || !c || !current.value || !/\.(http|rest)$/i.test(path)) return null
      const requests =
        m.files?.collections.flatMap((c) => c.requests).filter((r) => r.origin.file === path) ?? []
      return {
        text: m.files?.text(path),
        requests: requests.map((r) => {
          const outcome = m.entry(r.id).outcome
          return {
            line: r.origin.line,
            name: r.doc.name,
            sending: m.state.sending.includes(r.id),
            ...(outcome?.kind === 'answered'
              ? { last: { status: outcome.response.status, ms: outcome.response.ms } }
              : outcome?.kind === 'failed' || outcome?.kind === 'unknown'
                ? { last: { failed: true } }
                : {}),
          }
        }),
        send: (line) => {
          const r = requests.find((r) => r.origin.line === line)
          if (r) sendFromView(c, r.id)
        },
        open: (line) => {
          const r = requests.find((r) => r.origin.line === line)
          if (r)
            void openRequestTab(c, r.id)
              .then(() => onOpenRequest?.())
              .catch(say)
        },
      }
    })
  )
  return {
    available: computed(
      () =>
        current.value &&
        /\.(http|rest)$/i.test(
          target.value?.location.kind === 'file' ? target.value.location.path : ''
        )
    ),
    async open() {
      const c = context.value,
        at = target.value
      if (!c || !at || at.location.kind !== 'file') return
      const service = RequestsService.instance()
      service.chooseOpenProject(c)
      const { openRequestsView } = await import('./views')
      await openRequestsView(undefined, false)
      const filePath = at.location.path
      service.reveal.value = {
        collection: at.location.path.split('/').at(-1),
        ids:
          model.value?.files?.collections
            .find((c) => c.file.path === filePath)
            ?.requests.map((r) => r.id) ?? [],
        at: Date.now(),
      }
    },
  }
}
