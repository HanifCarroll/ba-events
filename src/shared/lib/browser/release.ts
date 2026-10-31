import { initialTransition, setup, transition, types } from 'xstate'

export const browserReleaseMachine = setup({
  schemas: { events: { RELEASE: types<{}>(), CONFIRMED: types<{}>(), UNCONFIRMED: types<{}>() } },
}).createMachine({
  id: 'browserRelease',
  initial: 'owned',
  states: {
    owned: { on: { RELEASE: { target: 'releasing' } } },
    releasing: { on: { CONFIRMED: { target: 'released' }, UNCONFIRMED: { target: 'unconfirmed' } } },
    unconfirmed: { on: { RELEASE: { target: 'releasing' } } },
    released: { type: 'final' },
  },
})

/** Coalesce concurrent releases, but allow a later cleanup to retry an unconfirmed release. */
export function createBrowserRelease(release: () => Promise<void>): () => Promise<void> {
  let [snapshot] = initialTransition(browserReleaseMachine)
  let pending: Promise<void> | undefined
  return () => {
    if (snapshot.matches('released')) return Promise.resolve()
    if (snapshot.matches('releasing')) return pending!
    ;[snapshot] = transition(browserReleaseMachine, snapshot, { type: 'RELEASE' })
    pending = Promise.resolve().then(release).then(() => {
      ;[snapshot] = transition(browserReleaseMachine, snapshot, { type: 'CONFIRMED' })
    }, (error: unknown) => {
      ;[snapshot] = transition(browserReleaseMachine, snapshot, { type: 'UNCONFIRMED' })
      throw error
    })
    return pending
  }
}
