const kinds = [
  'Error',
  'TypeError',
  'SyntaxError',
  'ReferenceError',
  'TimeoutError',
  'AbortError',
  'InvalidReply',
]
const kindOf = (value) => (kinds.includes(value) ? value : 'Error')

export async function flushExitEvidence(device, minimal = false, { requireProfiler = true } = {}) {
  try {
    const result = await device.evaluate(`
      const safeKind=error=>${JSON.stringify(kinds)}.includes(error?.name)?error.name:'Error';
      const failed=(category,error)=>({flushed:false,diagnostic:{category,kind:safeKind(error)}});
      ${
        minimal
          ? ''
          : `try {globalThis.__scalePrepareTeardown?.();await globalThis.__scaleFlushEntryLedger?.();}
        catch(error){return failed('ledger-flush-failed',error);}`
      }
      let profilerExported=false;
      if(typeof globalThis.__scaleStopProfiles==='function') {
        try {await globalThis.__scaleStopProfiles();profilerExported=true;}
        catch(error){return failed('profiler-stop-failed',error);}
      } else if(${requireProfiler}) return failed('profiler-hook-unavailable');
      ${
        minimal
          ? ''
          : `if(typeof globalThis.__scaleFlushEvidence!=='function')return failed('evidence-hook-unavailable');
        try {if(!await globalThis.__scaleFlushEvidence())return failed('evidence-flush-failed');}
        catch(error){return failed('evidence-flush-failed',error);}`
      }
      return {flushed:true,profilerExported};
    `)
    if (result?.flushed === true)
      return { flushed: true, profilerExported: result.profilerExported === true }
    const categories = [
      'ledger-flush-failed',
      'profiler-stop-failed',
      'profiler-hook-unavailable',
      'evidence-hook-unavailable',
      'evidence-flush-failed',
    ]
    return {
      flushed: false,
      diagnostic: {
        kind: kindOf(result?.diagnostic?.kind),
        category: categories.includes(result?.diagnostic?.category)
          ? result.diagnostic.category
          : 'invalid-reply',
      },
    }
  } catch (error) {
    const source = error.scaleObservationError ?? {}
    const category =
      source.timedOut === true || source.kind === 'TimeoutError'
        ? 'timeout'
        : source.category === 'renderer-gone'
          ? 'renderer-gone'
          : source.category === 'cli-execution-failure'
            ? 'cli-execution-failure'
            : 'evaluation-rejected'
    return { flushed: false, diagnostic: { category, kind: kindOf(source.kind ?? error.name) } }
  }
}

export async function stopAtCommitCut({ stop, release }) {
  await stop(true, { minimal: true, requireProfiler: true })
  release()
}
