import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SideTurn } from '../types'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'side', description: 'Open a side chat with a fork of this conversation; /side <question> asks it', immediate: true })

    return next(e)
  })

  on('command.run', { command: 'side' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'Side chat', focus: true, closeOnEscape: true, backgroundColor: 'transparent' })
    void openAndAskQuestion($, e.args)

    return { text: 'Side chat opened.' }
  })

  // A call of a side-chat agent, or of an unknown agent while a spawn has not named its agent, may only read.
  on('tool.check', async ($, e, next) => {
    if (e.agentId === undefined) return next(e)
    const role = await roleOf($, e.agentId).catch((): AgentRole => 'maybe-side-chat')
    if (role === 'other') return next(e)
    if (!(await isReadOnlyCall($, e.tool, e.input, e.isReadOnly === true))) {
      return { decision: 'deny', reason: `side chat: ${e.tool} is not a read-only call; use ${READ_ONLY_TOOL_NAMES}` }
    }

    return withoutPrompt(await next(e))
  })

  on('agent.report', async ($, e, next) => {
    const open = await read($, openQuestion)
    const answer: SideTurn = e.status === 'completed' ? { author: 'claude', text: e.text } : { author: 'error', text: `No reply (${e.status}): ${e.text}` }
    if (open !== null && open.agentId === e.agentId) {
      await appendAnswerAndCloseQuestion($, open.id, answer)
      return { consumed: 'side chat answer' }
    }
    const role = await roleOf($, e.agentId).catch((): AgentRole => 'other')
    if (role === 'other') return next(e)
    if (open !== null && open.agentId === null) await keepEarlyAnswer($, e.agentId, answer)
    else await appendTurn($, answer)

    return { consumed: 'side chat answer' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown, Input, Button } = $.ui.resolve(e)
    const [turns, question] = await Promise.all([read($, thread), read($, openQuestion)])
    const isAsking = question !== null
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
        <Input key="question" placeholder="Ask the side chat" submitLabel="send" autoFocus rows={3} onSubmit={value => void openAndAskQuestion($, value)} />
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

const PLUGIN = 'side-chat'
const PANE = 'side-chat'
const thread = atom({ plugin: 'side-chat', key: 'thread' } as const, [], { shape: 'thread-1' })
// The question that waits for its answer, with its agent once `spawn` resolves; null when the side chat takes a new question.
const openQuestion = atom({ plugin: 'side-chat', key: 'openQuestion' } as const, null)
// Answers that reached `agent.report` before `spawn` resolved and named their agent, by agent id.
const earlyAnswers = atom({ plugin: 'side-chat', key: 'earlyAnswers' } as const, {})
// The ids of the agents this plugin spawned in this session; the agent list may drop an agent that has ended.
const spawnedAgents = atom({ plugin: 'side-chat', key: 'spawnedAgents' } as const, [])

// One row per author of a turn: the header, its color, whether a box frames the turn, and whether the text is markdown.
const AUTHORS = {
  you: { label: 'You', color: 'suggestion', hasFrame: true, isMarkdown: false },
  claude: { label: 'Claude', color: 'claude', hasFrame: true, isMarkdown: true },
  error: { label: 'Error', color: 'error', hasFrame: false, isMarkdown: false },
} as const

// One row per tool the side-chat agent may call. `needsReadOnlyInput`: the engine or the classifier must judge this
// input read-only.
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

const READ_ONLY_LABEL = 'read-only'
const CALL_LABELS = [READ_ONLY_LABEL, 'changes-state'] as const

// The engine's read-only verdict comes first; a call it cannot judge read-only goes to the classifier.
const isReadOnlyCall = async ($: EngineInterface, tool: string, input: unknown, isReadOnlyInput: boolean): Promise<boolean> => {
  const row = READ_ONLY_TOOLS.find(candidate => candidate.tool === tool)
  if (row === undefined) return false
  if (isReadOnlyInput || !row.needsReadOnlyInput) return true

  return (await classifyCall($, tool, input)) === READ_ONLY_LABEL
}

// A failed classification counts as a call that changes state.
const classifyCall = async ($: EngineInterface, tool: string, input: unknown): Promise<string | undefined> => {
  const call = `Does this ${tool} call only read, or can it change files, processes, or remote state? ${JSON.stringify(input)}`

  return $.model.classify(call, CALL_LABELS).catch(() => undefined)
}

const withoutPrompt = (verdict: ToolCheckVerdict): ToolCheckVerdict =>
  verdict.decision === 'ask' ? { decision: 'allow', reason: 'side chat: a read-only call runs without a prompt' } : verdict

type ToolCheckVerdict = { decision: 'allow' | 'ask' | 'deny'; reason?: string }

// `side-chat`: this plugin spawned the agent. `maybe-side-chat`: no source knows the agent while a spawn has not named
// its agent yet, so it may be the side-chat agent that runs before `spawn` resolves. `other`: any other agent.
type AgentRole = 'side-chat' | 'maybe-side-chat' | 'other'

const roleOf = async ($: EngineInterface, agentId: string): Promise<AgentRole> => {
  if ((await read($, spawnedAgents)).includes(agentId)) return 'side-chat'
  const agents = await $.agent.list()
  const listed = agents.find(agent => agent.id === agentId)
  if (listed !== undefined) return listed.spawnedBy === PLUGIN ? 'side-chat' : 'other'
  const open = await read($, openQuestion)

  return open !== null && open.agentId === null ? 'maybe-side-chat' : 'other'
}

// Opens the question in `openQuestion`, appends it to `thread`, adds the started agent to `spawnedAgents`,
// and names that agent in `openQuestion`; a question that comes while one is open is dropped.
const openAndAskQuestion = async ($: EngineInterface, question: string): Promise<void> => {
  const text = question.trim()
  if (text === '') return
  const questionId = `${Date.now()}-${Math.random()}`
  const claimed = await update($, openQuestion, current => current ?? { id: questionId, agentId: null })
  if (claimed?.id !== questionId) return
  const started = await appendAndSpawn($, text).catch(error => ({ deny: `the question failed: ${String(error)}` }))
  if ('deny' in started) {
    await appendNotice($, `No reply: ${started.deny}`).catch(() => undefined)
    await update($, openQuestion, current => (current?.id === questionId ? null : current))
    return
  }
  try {
    await update($, spawnedAgents, ids => [...ids, started.agentId])
    await update($, openQuestion, current => (current?.id === questionId ? { id: questionId, agentId: started.agentId } : current))
    await deliverEarlyAnswers($)
  } catch (error) {
    await appendNotice($, `No reply: the side chat lost track of its agent: ${String(error)}`).catch(() => undefined)
    await update($, openQuestion, current => (current?.id === questionId ? null : current))
  }
}

// Keeps an answer whose agent `openQuestion` does not name yet, then delivers it if the agent was named meanwhile.
const keepEarlyAnswer = async ($: EngineInterface, agentId: string, answer: SideTurn): Promise<void> => {
  await update($, earlyAnswers, answers => ({ ...answers, [agentId]: answer }))
  await deliverEarlyAnswers($)
}

// Once `openQuestion` names its agent, or is closed, empties `earlyAnswers`: the named agent's answer closes the
// question, and the answer of any older agent joins `thread` as it is.
const deliverEarlyAnswers = async ($: EngineInterface): Promise<void> => {
  const open = await read($, openQuestion)
  if (open !== null && open.agentId === null) return
  for (const [agentId, answer] of Object.entries(await takeEarlyAnswers($))) {
    if (open !== null && open.agentId === agentId) await appendAnswerAndCloseQuestion($, open.id, answer)
    else await appendTurn($, answer)
  }
}

const takeEarlyAnswers = async ($: EngineInterface): Promise<Record<string, SideTurn>> => {
  let taken: Record<string, SideTurn> = {}
  await update($, earlyAnswers, answers => {
    taken = answers
    return {}
  })

  return taken
}

const appendTurn = async ($: EngineInterface, turn: SideTurn): Promise<void> => {
  await update($, thread, list => [...list, turn])
}

const appendAndSpawn = async ($: EngineInterface, text: string): Promise<{ agentId: string } | { deny: string }> => {
  const before = await read($, thread)
  await update($, thread, list => [...list, { author: 'you', text } as SideTurn])

  return spawnReaderNotingFallbacks($, sidePrompt(before, text))
}

// Appends the answer to `thread` and closes the question in `openQuestion`, also when the append fails.
const appendAnswerAndCloseQuestion = async ($: EngineInterface, questionId: string, answer: SideTurn): Promise<void> => {
  try {
    await appendTurn($, answer)
  } finally {
    await update($, openQuestion, current => (current?.id === questionId ? null : current))
  }
}

const appendNotice = async ($: EngineInterface, text: string): Promise<void> => {
  await appendTurn($, { author: 'error', text })
}

// Tries each agent type in turn; before a fallback spawns, appends to `thread` why the previous type did not start,
// so the notice stands above the fallback's answer.
const spawnReaderNotingFallbacks = async ($: EngineInterface, prompt: string): Promise<{ agentId: string } | { deny: string }> => {
  const denials: string[] = []
  for (const subagentType of AGENT_TYPES) {
    if (denials.length > 0) await appendNotice($, `Trying ${subagentType} without the conversation: ${denials.at(-1)}`)
    // A thrown spawn may have started the agent, so it ends the tries; only a refusal falls back.
    const started = await $.agent.spawn({ prompt, subagentType, description: 'side chat', name: 'side-chat' })
    if (started.agentId !== undefined) return { agentId: started.agentId }
    denials.push(`spawn ${subagentType}: ${started.deny ?? 'no agent id'}`)
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
