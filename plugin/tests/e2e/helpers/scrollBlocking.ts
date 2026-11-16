/** Long-frame script timing retains synchronous waits that CPU accounting omits. */
export function scrollBlocking() {
  return {
    maxScriptMs: 0,
    scripts: [] as { sourceURL: string; duration: number; pauseDuration?: number }[],
    record(
      entries: { scripts?: { sourceURL: string; duration: number; pauseDuration?: number }[] }[]
    ) {
      for (const entry of entries)
        for (const script of entry.scripts ?? []) {
          if (
            !/^plugin:abele(?:[/:]|$)|\/plugins\/abele\/main\.js(?:$|[?#])/.test(script.sourceURL)
          )
            continue
          if (Math.max(script.duration, script.pauseDuration ?? 0) > 50)
            this.scripts.push({
              sourceURL: script.sourceURL,
              duration: script.duration,
              pauseDuration: script.pauseDuration,
            })
          this.maxScriptMs = Math.max(this.maxScriptMs, script.duration, script.pauseDuration ?? 0)
        }
    },
  }
}
