// This function is also serialized into controller evaluations. Keep it self-contained.
exports.saveInterruptionBoundary = async function saveInterruptionBoundary({
  id,
  emit = () => {},
  stopProfiles,
  flushEvidence,
  requireProfiler = true,
  requireEvidence = true,
  now = () => Date.now(),
}) {
  const kinds = [
    'Error',
    'TypeError',
    'SyntaxError',
    'ReferenceError',
    'TimeoutError',
    'AbortError',
  ]
  const failed = (category, error) => ({
    flushed: false,
    diagnostic: { kind: kinds.includes(error?.name) ? error.name : 'Error', category },
  })
  const at = now()
  emit({ event: 'harness-interruption-boundary', id, at })
  let result
  if (typeof stopProfiles !== 'function') {
    result = requireProfiler
      ? failed('profiler-hook-unavailable')
      : { flushed: true, profilerExported: false }
  } else {
    try {
      await stopProfiles()
      result = { flushed: true, profilerExported: true }
    } catch (error) {
      result = failed('profiler-stop-failed', error)
    }
  }
  if (result.flushed && requireEvidence) {
    if (typeof flushEvidence !== 'function') result = failed('evidence-hook-unavailable')
    else
      try {
        if (!(await flushEvidence())) result = failed('evidence-flush-failed')
      } catch (error) {
        result = failed('evidence-flush-failed', error)
      }
  }
  emit({ event: 'interruption-cpu-export', id, boundaryAt: at, ...result, at: now() })
  if (typeof flushEvidence === 'function') {
    try {
      if (!(await flushEvidence())) result = failed('evidence-flush-failed')
    } catch (error) {
      result = failed('evidence-flush-failed', error)
    }
    if (!result.flushed)
      emit({ event: 'interruption-cpu-export', id, boundaryAt: at, ...result, at: now() })
  }
  return result
}
