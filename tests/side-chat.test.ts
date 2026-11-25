import { expect, test } from 'claude-code/testing'

const PANE_PROPS = { title: 'Side chat', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

// A spawn hook that answers without `next` starts no agent, so every spawn here is refused with "no agent id".
const refuseEverySpawn = (on: Parameters<Parameters<typeof test>[1]>[1], spawned: string[]) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', (_, e: { subagent_type?: string; subagentType?: string }) => {
    spawned.push(e.subagent_type ?? e.subagentType ?? 'unknown')
    return { model: 'test-model' }
  })
}

const settle = () => new Promise(resolve => setTimeout(resolve, 50))

test('a question sent while another is open starts no second spawn', async ($, on) => {
  const spawned: string[] = []
  refuseEverySpawn(on, spawned)

  await Promise.all([$.command.run({ command: 'side', args: 'first question' }), $.command.run({ command: 'side', args: 'second question' })])
  await settle()

  expect(spawned).toEqual(['fork', 'Explore'])
})

test('a refused spawn shows no reply and frees the side chat for the next question', async ($, on) => {
  const spawned: string[] = []
  refuseEverySpawn(on, spawned)

  await $.command.run({ command: 'side', args: 'first question' })
  await settle()
  await $.command.run({ command: 'side', args: 'second question' })
  await settle()

  const ui = await $.ui.mount({ plugin: 'side-chat', component: 'Pane', requestId: 'side-chat', surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ key: 'turn-1' }))?.text).toBe('ErrorNo reply: spawn fork: no agent id; spawn Explore: no agent id')
  expect(spawned).toEqual(['fork', 'Explore', 'fork', 'Explore'])
})
