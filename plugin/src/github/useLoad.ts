import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'

export interface Loaded<T> {
  data: ShallowRef<T | null>
  error: Ref<string | null>
  loading: Ref<boolean>
  /** Starts a load. A load still running when the next starts is ignored when it lands. */
  load(): Promise<void>
}

/** One request's life on screen: nothing yet, loading, an answer, or what went wrong. */
export function useLoad<T>(fetch: () => Promise<T>): Loaded<T> {
  const data = shallowRef<T | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)
  let generation = 0

  const load = async () => {
    const mine = ++generation
    loading.value = true
    error.value = null
    try {
      const result = await fetch()
      if (mine !== generation) return
      data.value = result
    } catch (e) {
      if (mine !== generation) return
      console.debug('[Abele] GitHub request failed', e)
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  return { data, error, loading, load }
}
