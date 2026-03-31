# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Unofficial reconstruction of `@anthropic-ai/claude-code` v2.1.88, extracted from the npm package's sourcemap (`cli.js.map`). Contains ~4,756 files including 1,884 TypeScript/TSX source files. **For research purposes only** — copyright belongs to Anthropic.

## Build & Run

```bash
cd restored-src
bun run build        # Bun bundler → dist/cli.js (~15MB single file)
node dist/cli.js     # Run the CLI
```

- Requires Node.js >= 18.0.0 and Bun
- Build uses custom Bun plugin for `bun:bundle` macro substitution (MACRO.VERSION, MACRO.BUILD_TIME, etc.)
- TypeScript config: ES2022, ESNext modules, react-jsx, bundler resolution, strict disabled

## Architecture

All source lives under `restored-src/src/`. Entry point: `entrypoints/cli.tsx`.

### Core Loop

The conversation engine is a **stateful async generator** (`query.ts` + `QueryEngine.ts`):

```
Loop: pre-process → API call (streaming SSE) → parse tool_use blocks →
      execute tools in parallel batches → check continuation route → loop or stop
```

Seven continuation routes: `next_turn`, `max_output_tokens_escalate`, `reactive_compact_retry`, `collapse_drain_retry`, `stop_hook_blocking`, `token_budget_continuation`, and terminal stop.

### Key Modules

| Module | Path | Role |
|--------|------|------|
| Bootstrap | `main.tsx` (4.7K lines) | CLI init, command routing, prefetch orchestration |
| Conversation | `query.ts` + `QueryEngine.ts` | Core agent loop, streaming, state transitions |
| API Client | `services/api/claude.ts` (3.4K lines) | SSE streaming, retry, rate limiting, prompt cache |
| Tools | `tools/` (45 tools) | BashTool, FileEdit, AgentTool, MCPTool, etc. |
| Tool Orchestration | `services/tools/toolOrchestration.ts` | Parallel/serial batching (max 10 concurrent read-only) |
| Bash Security | `tools/BashTool/bashSecurity.ts` (2.6K lines) | Multi-stage shell command validator (whitelist → AST parse → 20+ validators) |
| Permissions | `utils/permissions/` (~1.3K lines) | 6 modes (default/acceptEdits/auto/bypass/plan/dontAsk), rule merging from 6 sources |
| Hooks | `utils/hooks.ts` (5K lines) | 20+ lifecycle events, subprocess IPC |
| Context Compression | `services/compact/` | 3-tier: micro (zero API) → session memory → full compact (LLM call) |
| System Prompt | `constants/prompts.ts` + `utils/systemPrompt.ts` | Static/dynamic boundary for prompt cache optimization |
| CLAUDE.md Loader | `utils/claudemd.ts` | 4-tier loading (managed/user/project/local), @include directives |
| Settings | `utils/settings/` | 5-level hierarchy (managed → user → project → local → session), MDM support |
| MCP | `services/mcp/` | Model Context Protocol client, auto-discovery, tool bridging |
| REPL UI | `screens/REPL.tsx` (5K lines) | React-based terminal UI (Ink-style custom renderer) |

### Multi-Agent System

Three agent types with different isolation levels:
- **SubAgent**: Isolated context, spawned via AgentTool
- **Fork**: Inherits parent system prompt + history (shares prompt cache)
- **Teammate**: Independent process, file-system mailbox (`~/.claude/mailbox/`), swarm backends (tmux/iTerm2/in-process)

Coordinator mode (`CLAUDE_CODE_COORDINATOR_MODE` env) enables user-facing dispatcher + worker agents with `<task-notification>` routing.

### Tool Interface

Each tool implements 4 concern layers:
- **Execution**: `call(args, context, canUseTool, parentMessage, onProgress?)`
- **Model-aware**: `description()` (token-efficient) + `prompt()` (detailed, cached)
- **Safety**: `validateInput()`, `checkPermissions()`, `isReadOnly()`, `isDestructive()`
- **Concurrency**: `isConcurrencySafe()` — tools are non-concurrent and write-capable by default

### Prompt Cache Strategy

System prompt uses `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker:
- Before marker: ~5K tokens, static → `scope: 'global'` (cross-user shared cache)
- After marker: user/session-specific → per-user cache

Fork agents reuse parent's pre-rendered byte buffer to share the cache prefix.
