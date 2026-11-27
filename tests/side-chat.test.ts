import { expect, test } from 'claude-code/testing'

const PANE_PROPS = { title: 'Side chat', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

type On = Parameters<Parameters<typeof test>[1]>[1]

// A spawn hook that answers without `next` starts no agent, so every spawn is refused with "no agent id".
// Returns the list that each refused spawn appends its agent type to.
const recordRefusedSpawns = (on: On): string[] => {
  const spawned: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', (_, e: { subagent_type?: string; subagentType?: string }) => {
    spawned.push(e.subagent_type ?? e.subagentType ?? 'unknown')
    return { model: 'test-model' }
  })

  return spawned
}

const settle = () => new Promise(resolve => setTimeout(resolve, 50))

test('a question sent while another is open starts no second spawn', async ($, on) => {
  const spawned = recordRefusedSpawns(on)

  await Promise.all([$.command.run({ command: 'side', args: 'first question' }), $.command.run({ command: 'side', args: 'second question' })])
  await settle()

  expect(spawned).toEqual(['fork', 'Explore'])
})

test('a refused fork notes the Explore fallback, and a refused Explore shows no reply', async ($, on) => {
  recordRefusedSpawns(on)

  await $.command.run({ command: 'side', args: 'first question' })
  await settle()

  const ui = await $.ui.mount({ plugin: 'side-chat', component: 'Pane', requestId: 'side-chat', surface: 'terminal', props: PANE_PROPS })
  expect((await ui.find({ key: 'turn-1' }))?.text).toBe('ErrorTrying Explore without the conversation: spawn fork: no agent id')
  expect((await ui.find({ key: 'turn-2' }))?.text).toBe('ErrorNo reply: spawn fork: no agent id; spawn Explore: no agent id')
})

test('after a refused spawn the next question spawns again', async ($, on) => {
  const spawned = recordRefusedSpawns(on)
  await $.command.run({ command: 'side', args: 'refused question' })
  await settle()

  await $.command.run({ command: 'side', args: 'next question' })
  await settle()

  expect(spawned).toEqual(['fork', 'Explore', 'fork', 'Explore'])
})

type Engine = Parameters<Parameters<typeof test>[1]>[0]

// Starts the side-chat agent `a1` with `classify` as the engine's classifier; beneath the plugin, every tool call would ask.
const startSideChatAgent = async ($: Engine, on: On, classify: (_: unknown, e: { text: string }) => { value: string }): Promise<void> => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'test-model', agentId: 'a1' }))
  on('tool.check', () => ({ decision: 'ask' }))
  on('model.classify', classify)
  await $.command.run({ command: 'side', args: 'question' })
  await settle()
}

test('a Bash call the classifier judges read-only runs without a prompt', async ($, on) => {
  await startSideChatAgent($, on, () => ({ value: 'read-only' }))

  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'git log -1' }, agentId: 'a1' })

  expect(verdict.decision).toBe('allow')
})

test('a Bash call the classifier judges to change state is denied', async ($, on) => {
  await startSideChatAgent($, on, () => ({ value: 'changes-state' }))

  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, agentId: 'a1' })

  expect(verdict.decision).toBe('deny')
})

test('a Bash call is denied when the classification fails', async ($, on) => {
  await startSideChatAgent($, on, () => {
    throw new Error('classifier down')
  })

  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'make' }, agentId: 'a1' })

  expect(verdict.decision).toBe('deny')
})

test('a Bash call the engine judges read-only skips the classifier', async ($, on) => {
  const classified: string[] = []
  await startSideChatAgent($, on, (_, e) => {
    classified.push(e.text)
    return { value: 'changes-state' }
  })

  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, agentId: 'a1', isReadOnly: true })

  expect([verdict.decision, classified]).toEqual(['allow', []])
})
