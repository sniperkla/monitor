## Kiro

Welcome to Kiro CLI Guide!

Your friendly AI sidekick, ready to help you get the most out of the CLI. Here's what I can help with:

- Slash commands — /agent, /context, /tools and more
- Built-in tools — read, code, grep... basically superpowers
- Configuration settings — tweak things to your heart's content
- Features — MCP, Code Intelligence, and everything in between
- Create and modify agents, prompts, and configs in ~/.kiro/ and .kiro/

Go ahead, ask me anything about Kiro CLI — no question too weird!

Some fan favorites:
- "How do I save a conversation?"
- "What tools are available?"
- "How does the code tool work?"
- "Create a new agent for me"

Tip: Type /guide again to return to your previous agent

## User

How do I save a conversation

## Kiro

There are two ways to save a conversation:

**Auto-save** — Sessions are saved automatically after every turn. You don't need to do anything; they're stored in `~/.kiro/sessions/cli/` scoped to your current directory.

**Manual export to file** — Use `/chat save` to export the conversation to a JSON file:

```
/chat save my-session.json
```

You can reload it later with `/chat load my-session.json`.

The `--force` flag overwrites an existing file without prompting:
```
/chat save my-session.json --force
```

If you want to save a readable transcript instead of a resumable session, use `/transcript save`:
```
/transcript save               # saves as transcript.md
/transcript save --plain ~/notes/session.txt   # plaintext
/transcript save --json ./log.json             # JSON format
```

## User

if i hit limit can i use these command free?

## Kiro

The documentation doesn't explicitly address whether slash commands like `/chat save` or `/transcript save` count against your usage limit or are "free."

What is documented about hitting the monthly limit:

- When the monthly limit is reached, you'll see: *"The monthly usage limit has been reached"*
- The limit **cannot be cleared from the CLI** — you have to wait until access becomes available again, or contact your admin if unexpected.

The commands `/chat save` and `/transcript save` are local operations (writing to a file on your machine), so they don't involve calling the AI model. They should work regardless of your usage limit. But the documentation doesn't explicitly confirm this.

For definitive answers on what counts toward your limit and billing details, check your account at **app.kiro.dev/account/usage** or use `/usage` in chat to see your current usage status.

## User

usage

## Kiro

`/usage`

## User

how to copy

## Kiro

Use `/copy` to copy the last response to your clipboard:

```
/copy
```

That's it — it copies the most recent assistant response. If the response had multiple parts (interleaved with tool calls), they're all concatenated together.

For copying the full conversation instead, use `/transcript save` to export it to a file.