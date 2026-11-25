export type SideTurn = { author: 'you' | 'claude' | 'error'; text: string }

// The question that waits for its answer; agentId is null until spawn names the agent.
export type OpenQuestion = { id: string; agentId: string | null }

declare module 'claude-code' {
  interface PluginState {
    'side-chat': { thread: Shaped<SideTurn[]>; openQuestion: OpenQuestion | null; earlyAnswers: Record<string, SideTurn>; spawnedAgents: string[] }
  }
}
