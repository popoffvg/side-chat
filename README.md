# side-chat

A Claude Code mod that opens a side chat beside the main chat. The side chat talks to a fork of the conversation: it knows everything the main thread knows, and the main thread does not see it.

Use it to ask a quick question about the work while Claude goes on with the main task, without a new turn in the main thread and without a change to its context.

```
╭ Side chat ──────────────────────────────────────────────╮
│ > why did it pick a timer and not await the fork?        │
│ A hook has a time budget. A fork can take seconds, so    │
│ the hook starts it from $.clock.after(0) and returns.    │
│ Thinking…                                                │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Ask the side chat                              send │ │
│ └──────────────────────────────────────────────────────┘ │
│ [Use in prompt]  [New]  [Close]                          │
╰──────────────────────────────────────────────────────────╯
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install side-chat --marketplace popoffvg/side-chat
```

Answer `y` to add the marketplace, then pick a scope (user scope is first).

From a shell:

```sh
claude plugin install side-chat --marketplace popoffvg/side-chat
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `popoffvg/side-chat`, then **Add plugin**.

The mod needs a Claude Code build that loads mods (hooks modules).

## Usage

| Action | What it does |
| --- | --- |
| `/side` | Opens the side chat pane. |
| `/side <question>` | Opens the pane and asks the question. |
| type in the pane, then `send` | Asks the next question. The side chat keeps its own thread. |
| **Use in prompt** | Adds the last side-chat answer to the main prompt box. |
| **New** | Clears the side-chat thread. |
| **Close** or `Esc` | Closes the pane. The thread stays for the session. |

See [examples/](examples/) for sample sessions.

## How it works

```
/side <question>
   └─► $.model.fork(side-chat turns so far + question)
          ├─ the fork reads the main transcript from the prompt cache, with no tools
          └─► the answer goes into the pane (rendered as markdown)
```

- The fork uses the same model as the session. It reads the conversation from the prompt cache, so a question costs mostly its own text and the answer.
- Before the first turn of a session, and after `/clear`, there is nothing to fork. The mod then asks Sonnet with no history.
- The side-chat thread is session state: it lives through a reload of the mod and ends with the session.

## Development

```sh
claude --plugin-dir ~/path/to/side-chat   # run a session with the mod loaded
claude plugin validate ~/path/to/side-chat
```

The engine writes the API types to `.claude-plugin/types/` when it loads the mod. Then `tsc -p .` type-checks it.

## License

[MIT](LICENSE)
