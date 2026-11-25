import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SideTurn } from '../types'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'side', description: 'Open a side chat with a fork of this conversation; /side <question> asks it' })

    return next(e)
  })

  on('command.run', { command: 'side' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'Side chat', focus: true, closeOnEscape: true, backgroundColor: 'transparent' })
    void ask($, e.args)

    return { text: 'Side chat opened.' }
  })

  on('tool.check', async ($, e, next) => {
    if (e.agentId === undefined || e.agentId !== (await read($, askingAgent))) return next(e)
    if (!isReadOnlyCall(e.tool, e.isReadOnly === true)) {
      return { decision: 'deny', reason: `side chat: ${e.tool} is not a read-only call; use ${READ_ONLY_TOOL_NAMES}` }
    }
    const verdict = await next(e)
    if (verdict.decision !== 'ask') return verdict

    return { decision: 'allow', reason: 'side chat: a read-only call runs without a prompt' }
  }).catch(() => ({ decision: 'deny', reason: 'side chat: the read-only check failed' }))

  on('agent.report', async ($, e, next) => {
    if (e.agentId !== (await read($, askingAgent))) return next(e)
    const answer: SideTurn = e.status === 'completed' ? { author: 'claude', text: e.text } : { author: 'error', text: `No reply (${e.status}): ${e.text}` }
    await update($, thread, list => [...list, answer])
    await update($, askingAgent, () => null)

    return { consumed: 'side chat answer' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown, Input, Button } = $.ui.resolve(e)
    const turns = await read($, thread)
    const isAsking = (await read($, askingAgent)) !== null
    const lastReply = turns.findLast(turn => turn.author === 'claude')

    return (
      <Box flexDirection="column">
        {turns.length === 0 && <Text dimColor>Ask about the conversation. Claude here reads files and runs read-only commands only. The main thread does not see this chat.</Text>}
        {turns.map((turn, i) => {
          const author = AUTHORS[turn.author]
          return (
            <Box
              key={`turn-${i}`}
              flexDirection="column"
              marginBottom={1}
              paddingX={author.hasFrame ? 1 : 0}
              borderStyle={author.hasFrame ? 'round' : undefined}
              borderColor={author.color}
            >
              <Text bold color={author.color}>{author.label}</Text>
              {author.isMarkdown ? <Markdown text={turn.text} /> : <Text>{turn.text}</Text>}
            </Box>
          )
        })}
        {isAsking && <Text dimColor>Claude is reading…</Text>}
        <Input key="question" placeholder="Ask the side chat" submitLabel="send" autoFocus rows={3} onSubmit={value => void ask($, value)} />
        <Box>
          <Button key="use" label="Use in prompt" onPress={() => lastReply && $.prompt.fill({ text: lastReply.text, mode: 'append' })} />
          <Text> </Text>
          <Button key="new" label="New" onPress={() => update($, thread, () => [])} />
          <Text> </Text>
          <Button key="close" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}

const PANE = 'side-chat'
const thread = atom({ plugin: 'side-chat', key: 'thread' } as const, [], { shape: 'thread-1' })
const askingAgent = atom({ plugin: 'side-chat', key: 'askingAgent' } as const, null)

// One row per author of a turn: the header, its color, whether a box frames the turn, and whether the text is markdown.
const AUTHORS = {
  you: { label: 'You', color: 'suggestion', hasFrame: true, isMarkdown: false },
  claude: { label: 'Claude', color: 'claude', hasFrame: true, isMarkdown: true },
  error: { label: 'Error', color: 'error', hasFrame: false, isMarkdown: false },
} as const

// One row per tool the side-chat agent may call. `needsReadOnlyInput`: the engine must judge this input read-only.
const READ_ONLY_TOOLS = [
  { tool: 'Read', needsReadOnlyInput: false },
  { tool: 'Grep', needsReadOnlyInput: false },
  { tool: 'Glob', needsReadOnlyInput: false },
  { tool: 'LSP', needsReadOnlyInput: false },
  { tool: 'WebFetch', needsReadOnlyInput: false },
  { tool: 'WebSearch', needsReadOnlyInput: false },
  { tool: 'ToolSearch', needsReadOnlyInput: false },
  { tool: 'Bash', needsReadOnlyInput: true },
] as const

const READ_ONLY_TOOL_NAMES = READ_ONLY_TOOLS.map(row => (row.needsReadOnlyInput ? `${row.tool} (read-only input)` : row.tool)).join(', ')

// The fork answers with the main conversation; a session with nothing to fork yet gets the read-only Explore agent.
const AGENT_TYPES = ['fork', 'Explore'] as const

const isReadOnlyCall = (tool: string, isReadOnlyInput: boolean): boolean => {
  const row = READ_ONLY_TOOLS.find(candidate => candidate.tool === tool)
  if (row === undefined) return false

  return isReadOnlyInput || !row.needsReadOnlyInput
}

const ask = async ($: EngineInterface, question: string): Promise<void> => {
  const text = question.trim()
  if (text === '' || (await read($, askingAgent)) !== null) return
  const before = await read($, thread)
  await update($, thread, list => [...list, { author: 'you', text } as SideTurn])
  const started = await spawnReader($, sidePrompt(before, text))
  if ('deny' in started) {
    await update($, thread, list => [...list, { author: 'error', text: `No reply: ${started.deny}` } as SideTurn])
    return
  }

  await update($, askingAgent, () => started.agentId)
}

const spawnReader = async ($: EngineInterface, prompt: string): Promise<{ agentId: string } | { deny: string }> => {
  const denials: string[] = []
  for (const subagentType of AGENT_TYPES) {
    try {
      const started = await $.agent.spawn({ prompt, subagentType, description: 'side chat', name: 'side-chat' })
      if (started.agentId !== undefined) return { agentId: started.agentId }
      denials.push(`spawn ${subagentType}: ${started.deny ?? 'no agent id'}`)
    } catch (error) {
      denials.push(`spawn ${subagentType}: ${String(error)}`)
    }
  }

  return { deny: denials.join('; ') }
}

const sidePrompt = (turns: SideTurn[], question: string): string =>
  [
    'This is a side chat, a branch of the conversation above. The main thread does not see it.',
    `You may call only read-only tools: ${READ_ONLY_TOOL_NAMES}. Every other call is denied. Do not edit files, do not start agents, and do not run commands that change state.`,
    'Answer the question directly and briefly. Your final message is the answer the user reads.',
    ...turns
      .filter(turn => turn.author !== 'error')
      .map(turn => `${turn.author === 'you' ? 'User' : 'You'} (side chat): ${turn.text}`),
    `User (side chat): ${question}`,
  ].join('\n\n')
