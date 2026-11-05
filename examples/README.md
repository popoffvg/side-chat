# Examples

Each example is a side-chat question asked while the main thread works.

## Ask why, while the main turn runs

The main thread edits a hooks module. In the side chat:

```
/side why does the hook start the fork from a timer?
```

```
> why does the hook start the fork from a timer?

A hook runs inside one dispatch with a time budget. A fork can take
several seconds, so `prompt.submit` starts it from `$.clock.after(0)`
and returns at once. The turn does not wait for the fork.
```

## Draft the next prompt

```
> write the next prompt for the main thread: add a test for the short-reply case
```

The side chat answers with a prompt. Press **Use in prompt**, and the text goes into the main prompt box. Edit it there and send it.

## Check a fact from earlier in the conversation

```
> which file holds the risk colors?
```

```
`hooks/register.tsx`, in the `RISK_COLORS` table: green under 30,
orange from 30 to 60, red over 60.
```

The side chat reads the same transcript as the main thread, so it can answer about files and decisions from earlier turns. It has no tools, so it cannot open a file that the conversation has not shown.

## Start over

Press **New** to clear the side-chat thread. The main conversation does not change.
