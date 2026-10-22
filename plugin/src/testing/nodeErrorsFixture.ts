import { ref } from 'vue'

/** Reactive transport state for the non-executing node panel fixture. */
export function nodeErrorFixtureState() {
  return {
    state: ref('connected'),
    error: ref(''),
    version: ref('0.4.50'),
    activity: { slowSince: ref(0) },
  }
}
