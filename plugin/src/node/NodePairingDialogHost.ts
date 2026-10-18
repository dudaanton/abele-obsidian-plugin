import { uiField, uiErrorMessage, uiMessage, presentUiField } from '@/i18n/streamBErrors'

import { t } from '@/i18n'
import { h, shallowRef, watch } from 'vue'
import { NodeClient } from '@abele/node-client'
import { decodePairCode } from '@abele/node-protocol'
import { Platform } from 'obsidian'
import { NodeService } from './NodeService'
import { NodeClientStore } from './NodeClientStore'
import { NodePairingModel } from './NodePairingModel'
import { nodePathDialog } from './NodePathDialogs'
import { GlobalStore } from '@/stores/GlobalStore'
import { streamBTime as formatTimestamp } from '@/i18n/streamBDate'
import { confirmDialog } from '@/components/obsidian/dialogs'
import PairDialog from '@/components/nodeWork/PairDialog.vue'
import type { PairingCode } from '@/components/nodeWork/types'

export function showNodePairingDialog(): void {
  const service = NodeService.getInstance(),
    app = GlobalStore.getInstance().app
  const device = String(
    app.loadLocalStorage('abele-node-device-name') ||
      (Platform.isMobile ? 'Obsidian phone' : 'Obsidian desktop')
  )
  let candidate: { client: NodeClient; store: NodeClientStore } | undefined,
    adopted = false,
    closed = false
  const session = service.pairedConnector.createPairingSession({
    createClient: (target) => {
      if (target.profile !== 'paired-wss-v1') throw new Error('paired_profile_required')
      const store = new NodeClientStore(
        `paired-${target.expected_node_id}-${target.installation_id}`
      )
      const client = new NodeClient(target, store, {
        connect: () => service.pairedConnector.connect(target),
      })
      candidate = { client, store }
      return client
    },
  })
  const model = new NodePairingModel(
    session,
    async (payload) => {
      await service.deviceKeys.rememberInvitation(payload.invite, payload.node_name)
    },
    async (client, payload, current) => {
      if (!candidate || candidate.client !== client) throw new Error('pairing_client_changed')
      const node = await service.adoptPaired(
        payload.node_name,
        candidate.client,
        candidate.store,
        current
      )
      adopted = true
      const leaf = app.workspace.getLeavesOfType('abele-node-sidebar')[0]
      if (leaf)
        await leaf
          .setViewState({
            type: 'abele-node-sidebar',
            active: true,
            state: { registrationId: node.id },
          })
          .catch(() => {})
    }
  )
  const changed = shallowRef(false),
    previousPin = shallowRef('')
  let parsedText = ''
  const parse = (text: string): PairingCode | { error: string } => {
    try {
      const payload = decodePairCode(text),
        endpoint = new URL(payload.invite.endpoint)
      if (parsedText !== text) {
        parsedText = text
        changed.value = false
        previousPin.value = ''
        void service.deviceKeys
          .load(payload.invite.node_id)
          .then((device) => {
            if (closed || parsedText !== text) return
            previousPin.value = device?.node_fingerprint ?? ''
            changed.value =
              !!previousPin.value && previousPin.value !== payload.invite.node_fingerprint
          })
          .catch(() => {})
      }
      return {
        name: payload.node_name,
        nodeId: payload.invite.node_id,
        host: endpoint.hostname,
        port: Number(endpoint.port || 443),
        fingerprint: payload.invite.node_fingerprint,
        expires: formatTimestamp(payload.invite.expires_at, { mode: 'absolute' }).label,
        expiresShort: `${Math.max(0, Math.ceil((payload.invite.expires_at - Date.now()) / 60000))} min`,
      }
    } catch {
      return { error: t('streamB.pasteTheCompleteCodePrintedByAbele.8b217b') }
    }
  }
  const error = () => {
    const state = model.state.value
    if (state.addressError) {
      const reasons = {
        tls: t('streamB.tlsValidationFailed.2acd6b'),
        host_not_accepted: t('streamB.thePairedListenerDoesNotAcceptThis.e3f1e8'),
        unreachable: t('streamB.nothingAnswersAtThisAddress.3b8c53'),
        different_node: t('streamB.theNodeAtThisAddressDoesNot.17f78f'),
        tls_or_unreachable: t('streamB.theAddressCouldNotBeReachedOr.1d21a8'),
        policy_not_accepted: t('streamB.thePairedListenerRefusedThisOriginOr.f4d49f'),
      }
      return t('streamB.checkAddressAndPortAboveTheKey.a20220', {
        v0: String(reasons[state.addressError.reason]),
      })
    }
    if (state.error === 'node_identity_mismatch')
      return t('streamB.theNodeIdentityOrSavedKeyDoes.d1fa65')
    if (state.error === 'pairing_upgrade_required')
      return t('streamB.updateTheNodeBeforePairingWithThis.72b653')
    return state.phase === 'error'
      ? state.error != null
        ? presentUiField(state, 'error')
        : t('streamB.theNodeDidNotAdmitThisDevice.d5420c')
      : undefined
  }
  const connect = async (code: string, address: { host: string; port: number }) => {
    if (closed || ['claiming', 'waiting', 'connecting'].includes(model.state.value.phase)) return
    const payload = decodePairCode(code)
    const stored = await service.deviceKeys.load(payload.invite.node_id)
    if (stored && stored.node_fingerprint !== payload.invite.node_fingerprint) {
      if (
        !(await confirmDialog({
          title: t('streamB.replaceThisNodeKey.431243'),
          message: t('streamB.previouslyKnownKeyNewKeyContinueOnly.4de23d', {
            v0: String(stored.node_fingerprint),
            v1: String(payload.invite.node_fingerprint),
          }),
          confirmText: t('streamB.useVerifiedKey.043fac'),
        })) ||
        closed
      )
        return
      await service.pairedConnector.authorizeNodeKeyChange(payload.invite, stored.node_fingerprint)
    } else if (stored && stored.endpoint !== payload.invite.endpoint) {
      if (
        !(await confirmDialog({
          title: t('streamB.changeTheNodeSCanonicalEndpoint.1f5c38'),
          message: t('streamB.theSameNodeKeyMovedFromTo.c52ee4', {
            v0: String(stored.endpoint),
            v1: String(payload.invite.endpoint),
          }),
          confirmText: t('streamB.useVerifiedEndpoint.8c354c'),
        })) ||
        closed
      )
        return
      await service.deviceKeys.authorizeEndpointChange(
        payload.invite,
        stored.endpoint,
        stored.node_fingerprint
      )
    }
    if (!closed) await model.connect(code, device, address)
  }
  let stop = () => {}
  const close = nodePathDialog(
    t('streamB.connectNode.33abfd'),
    () =>
      h(PairDialog, {
        step: ['waiting', 'connecting'].includes(model.state.value.phase) ? 'waiting' : 'paste',
        parse,
        device,
        error: error(),
        keyChanged: changed.value,
        canScan: false,
        busy: model.state.value.phase === 'claiming',
        deviceFingerprint: model.state.value.deviceFingerprint,
        onConnect: (code: string, address: { host: string; port: number }) => {
          void connect(code, address).catch((failure: unknown) => {
            model.state.value = { ...model.state.value, phase: 'error' }
            uiField(
              model.state.value,
              'error',
              failure instanceof Error
                ? uiErrorMessage(failure)
                : uiMessage('streamB.couldNotPair.9cc847')
            )
          })
        },
        onBack: () => model.cancel(),
        onCopy: (text: string) => {
          void navigator.clipboard.writeText(text)
        },
      }),
    () => {
      closed = true
      stop()
      model.cancel()
      if (candidate && !adopted)
        void candidate.client.disconnect().finally(() => candidate?.store.close())
    },
    true
  )
  stop = watch(
    () => model.state.value.phase,
    (phase) => {
      if (phase === 'connected') close()
    }
  )
  const background = () => {
    if (document.visibilityState === 'hidden') model.cancel()
  }
  document.addEventListener('visibilitychange', background)
  const previous = stop
  stop = () => {
    previous()
    document.removeEventListener('visibilitychange', background)
  }
}
