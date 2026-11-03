export async function flushExitEvidence(device, minimal = false) {
  return device.evaluate(`
    ${minimal ? '' : 'globalThis.__scalePrepareTeardown?.();await globalThis.__scaleFlushEntryLedger?.();'}
    await globalThis.__scaleStopProfiles?.();
    ${minimal ? 'return true' : 'return globalThis.__scaleFlushEvidence ? await globalThis.__scaleFlushEvidence() : false'}
  `)
}
