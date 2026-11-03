import { join } from 'node:path'
import { instrumentationOf } from './qualification-config.mjs'
import { hashTracepointBoundary, hashTracepoints } from './reindex.mjs'

export function observerDeploymentConfig(config, observer, device, bundle) {
  return {
    evidence: join(config.output, 'renderer.jsonl'),
    device,
    interruptionBoundary: join(observer, 'interruption-boundary.cjs'),
    hostEntries: join(observer, 'host-entries.cjs'),
    evidenceWriter: join(observer, 'evidence-writer.cjs'),
    heapProbe: join(observer, 'heap.cjs'),
    controlError: join(observer, 'control-error.cjs'),
    ...(config.failureDiagnosticEnabled
      ? {
          failureDiagnostic: join(observer, 'failure-diagnostic.cjs'),
          failureEvents: join(config.output, `failure-events-${device}.jsonl`),
          failureMarker: join(config.output, `failure-marker-${device}.json`),
          failureArmed: join(config.output, 'failure-capture-armed'),
        }
      : {}),
    contentPrefix: config.contentPrefix,
    targeted: config.targeted === true,
    observeContentReads: false,
    writeObserver: join(observer, 'writes.cjs'),
    reindexObserver: join(observer, 'reindex.cjs'),
    diagnostics: join(observer, 'diagnostics.cjs'),
    entryLedger: join(observer, 'entry-ledger.cjs'),
    liveStartup: join(observer, 'live-startup.cjs'),
    startupReceipt: join(config.output, `live-startup-${device}.json`),
    receiptCapture: join(observer, 'receipt-capture.cjs'),
    fingerprintObserver: join(observer, 'failure-diagnostic.cjs'),
    profileGate: join(observer, 'profile-gate.cjs'),
    profileOnly: join(observer, 'profile-only.cjs'),
    metadataCache: join(observer, 'metadata-cache.cjs'),
    indexWaitCapture: join(observer, 'index-wait-capture.cjs'),
    profileDirectory: join(config.output, 'profiles'),
    ...instrumentationOf(config),
    javascriptHashBoundary: hashTracepointBoundary(bundle),
    javascriptHashTracepoints: hashTracepoints(bundle),
  }
}
