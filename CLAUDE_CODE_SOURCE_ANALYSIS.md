# Claude Code v2.1.88 源码分析

> 基于 @anthropic-ai/claude-code@2.1.88 sourcemap 还原，约 1,902 个源文件，51 万行 TypeScript/TSX 代码

---

## 一、对话引擎（Query Loop）

核心文件：`query.ts`（1,729 行）、`QueryEngine.ts`（1,295 行）、`services/api/claude.ts`（3,419 行）

### 1.1 主循环结构

`query.ts:307` 是一个 `while (true)` 循环，每次迭代完成一轮完整的模型交互：

1. 预处理：执行微压缩、context collapse、自动压缩
2. 调用 API：流式接收模型回复，收集 `tool_use` blocks
3. 分支：如果有工具调用，执行工具后将结果拼回消息数组（`query.ts:1716`），进入下一次迭代；如果没有工具调用，走 stop hooks 判定是否终止

消息在迭代间的传递方式（`query.ts:1715-1716`）：

```typescript
const next: State = {
  messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
  // ...
  transition: { reason: 'next_turn' },
}
state = next
```

纯追加式：原始消息 + 本轮助手回复 + 工具结果，组成新的消息数组传给下一轮。

### 1.2 async generator 的选型

`query()` 定义在 `query.ts:219`，签名是 `async function*`：

```typescript
export async function* query(
  params: QueryParams,
): AsyncGenerator<
  | StreamEvent | RequestStartEvent | Message
  | TombstoneMessage | ToolUseSummaryMessage,
  Terminal
> {
  const consumedCommandUuids: string[] = []
  const terminal = yield* queryLoop(params, consumedCommandUuids)
  for (const uuid of consumedCommandUuids) {
    notifyCommandLifecycle(uuid, 'completed')
  }
  return terminal
}
```

选 async generator 有几个具体的技术考量：

- `yield` 每次把一个流事件推给消费者（REPL UI 或 SDK），实现逐 token 的渲染
- 消费者不调 `.next()`，生产者不推进，天然的背压控制
- `.return()` 可以干净地关闭整条 generator 链，不需要额外的 abort signal 管理
- `yield` 和 `return` 分别承载不同类型：`yield` 推 `StreamEvent | Message`，`return` 返回 `Terminal`（终止原因枚举）

### 1.3 State 对象与状态转换

`query.ts:204-217` 定义了循环携带的可变状态：

```typescript
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  transition: Continue | undefined
}
```

每个 `continue` 站点都构造一个新的 State 对象赋给 `state`。`transition` 字段记录本次 continue 的原因，用于调试和测试断言。

### 1.4 错误恢复路径

循环内有 7 个 `continue` 站点，分别处理不同的中间状态：

**`next_turn`**（`query.ts:1725`）：正常工具调用完成后继续下一轮。

**`max_output_tokens_escalate`**（`query.ts:1217`）：模型输出被截断。如果当前使用的是默认 8k token 上限，将 `maxOutputTokensOverride` 设为 `ESCALATED_MAX_TOKENS`（64k），用相同的消息重试：

```typescript
// Escalating retry: if we used the capped 8k default and hit the
// limit, retry the SAME request at 64k — no meta message, no
// multi-turn dance.
```

**`max_output_tokens_recovery`**（`query.ts:1246`）：64k 仍然不够。注入恢复消息让模型继续输出，最多 3 次：

```typescript
const recoveryMessage = createUserMessage({
  content:
    `Output token limit hit. Resume directly — no apology, no recap of what you were doing. ` +
    `Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.`,
  isMeta: true,
})
```

**`reactive_compact_retry`**（`query.ts:1162`）：API 返回 prompt-too-long（413），执行一次压缩后重试。

**`collapse_drain_retry`**：context collapse 模块回收旧消息后重试。

**`stop_hook_blocking`**：stop hook 检出问题（如测试未通过），将错误信息注入对话让模型处理。

**`token_budget_continuation`**：token 预算未用完，注入 nudge 消息让模型继续工作。

### 1.5 流式工具执行

`query.ts:659` 开始处理 API 的流式响应。`StreamingToolExecutor`（`services/tools/StreamingToolExecutor.ts`）在模型流式输出的过程中，已经开始执行前面已完成的 `tool_use` block。模型输出一个 Read 调用后紧接着输出 Edit 调用时，Read 已经在执行了。

### 1.6 Token 预算的边际递减检测

`query/tokenBudget.ts`（93 行）：

```typescript
const COMPLETION_THRESHOLD = 0.9
const DIMINISHING_THRESHOLD = 500

export function checkTokenBudget(tracker, agentId, budget, globalTurnTokens) {
  if (agentId || budget === null || budget <= 0) {
    return { action: 'stop', completionEvent: null }
  }
  const turnTokens = globalTurnTokens
  const deltaSinceLastCheck = globalTurnTokens - tracker.lastGlobalTurnTokens
  const isDiminishing =
    tracker.continuationCount >= 3 &&
    deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
    tracker.lastDeltaTokens < DIMINISHING_THRESHOLD

  if (!isDiminishing && turnTokens < budget * COMPLETION_THRESHOLD) {
    return { action: 'continue', nudgeMessage: ... }
  }
}
```

两个阈值：使用不到 90% 预算则继续；连续 3 轮增量不足 500 token 则判定边际递减，提前停止，避免模型反复输出无意义的小增量。

### 1.7 其他细节

**Tombstone 机制**（`query.ts:713-728`）：流式传输中途触发模型回退（如从 Opus 降到 Sonnet）时，已经 yield 出去的部分消息通过 tombstone 通知消费者移除，防止 thinking block 签名不匹配导致后续 API 调用 400。

**工具摘要并行生成**：工具执行完后立即启动 Haiku 生成工具摘要（`nextPendingToolUseSummary`），不阻塞主循环。摘要在下一轮 API 流式传输期间在后台完成。

**流式空闲看门狗**（`claude.ts`）：90 秒无数据主动 abort 并回退到 non-streaming 模式。SDK 的 request timeout 只覆盖初始 fetch，不覆盖 streaming body，这个看门狗补上了这个盲区。

---

## 二、上下文管理与压缩系统

核心文件：`services/compact/autoCompact.ts`（351 行）、`services/compact/compact.ts`、`services/compact/microCompact.ts`、`services/compact/sessionMemoryCompact.ts`、`utils/context.ts`

### 2.1 三层压缩架构

按开销从低到高：

**Micro Compact（微压缩）**：每次 API 请求前执行，零 API 调用。将旧的工具输出替换为 `'[Old tool result content cleared]'`。可清理的工具列表（`microCompact.ts`）：

```typescript
const COMPACTABLE_TOOLS = new Set([
  FILE_READ_TOOL_NAME, ...SHELL_TOOL_NAMES,
  GREP_TOOL_NAME, GLOB_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME,
  FILE_EDIT_TOOL_NAME, FILE_WRITE_TOOL_NAME,
])
```

时间驱动微压缩的阈值是 60 分钟（`timeBasedMCConfig.ts`），和服务端 prompt cache 的 1 小时 TTL 对齐。缓存过期后整个前缀都要重写，此时清理旧工具结果能减少重写量，不会产生额外的 cache miss。

**Session Memory Compact（会话记忆压缩）**：零 API 调用。Claude Code 在后台持续提取会话记忆，压缩时直接用已有的记忆替代 LLM 摘要。`sessionMemoryCompact.ts` 文件头标注 `EXPERIMENT`，目前是实验功能。

**Full Compact（完整压缩）**：需要一次 LLM 调用生成摘要。是最后手段。

调用顺序在 `autoCompactIfNeeded()` 里：先试 Session Memory Compact，失败才调 Full Compact。

### 2.2 阈值计算

`autoCompact.ts:33-48`，有效上下文窗口计算：

```typescript
export function getEffectiveContextWindowSize(model: string): number {
  const reservedTokensForSummary = Math.min(
    getMaxOutputTokensForModel(model),
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,  // 20,000
  )
  let contextWindow = getContextWindowForModel(model, getSdkBetas())
  // ...环境变量覆盖...
  return contextWindow - reservedTokensForSummary
}
```

20,000 的预留值来自 p99.99 的压缩摘要输出统计（17,387 token）。

缓冲区常量（`autoCompact.ts:62-65`）：

```typescript
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000
```

以 200K 上下文模型为例：

- 有效窗口 = 200,000 - 20,000 = 180,000 token
- 自动压缩触发 = 180,000 - 13,000 = 167,000 token
- 阻断限制 = 180,000 - 3,000 = 177,000 token（到此必须手动 `/compact`）

### 2.3 断路器

`autoCompact.ts:67-70`：

```typescript
// BQ 2026-03-10: 1,279 sessions had 50+ consecutive failures (up to 3,272)
// in a single session, wasting ~250K API calls/day globally.
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3
```

3 次连续失败后停止重试。这个值和注释里的日期、数据说明它是从生产问题中加上的。

### 2.4 压缩后文件恢复

`compact.ts` 的 `createPostCompactFileAttachments` 在压缩后重新注入最近读取的文件：

- 最多恢复 5 个文件，总预算 50K token，每文件 5K token
- 技能恢复预算 25K token，每技能 5K token
- 排除 plan 文件和 CLAUDE.md（它们有独立的恢复机制）
- 排除 preserved messages 中已包含的文件读取结果

### 2.5 递归防护

`autoCompact.ts:170-183`：compact、session_memory、context collapse 的子 agent 查询不触发自动压缩，避免递归。

---

## 三、工具系统

核心文件：`Tool.ts`（792 行）、`tools.ts`（389 行）、`tools/BashTool/`、`tools/AgentTool/`、`services/tools/toolOrchestration.ts`

### 3.1 Tool 接口

`Tool.ts` 定义的接口按关注点分四层：

**执行**：`call(args, context, canUseTool, parentMessage, onProgress?)` 是所有工具的统一入口。

**模型感知**：`description()` 返回短描述（进入 API 的 tool schema，每次计入 token 费用），`prompt()` 返回详细指令（注入系统提示词，走 prompt cache）。两者分离是一个 token 优化：description 每次都付费所以尽量短，prompt 可以被缓存所以可以写详细。

**安全**：`validateInput()` 校验输入、`checkPermissions()` 检查权限、`isReadOnly()` / `isDestructive()` 标记行为属性。

**并发**：`isConcurrencySafe()` 标记是否可以并行执行。

### 3.2 默认值策略

`buildTool()` 的默认值：

```typescript
const TOOL_DEFAULTS = {
  isConcurrencySafe: (_input?) => false,
  isReadOnly: (_input?) => false,
  isDestructive: (_input?) => false,
}
```

默认假设工具不可并发、会写入。安全的工具需要主动声明。

### 3.3 BashTool 安全管道

`bashSecurity.ts`（2,592 行）实现了一个验证器管道，20 多个验证器串行执行。几个典型的：

- `validateUnicodeWhitespace`：检测 Unicode 零宽字符伪装的命令分隔符
- `validateCarriageReturn`：防 `\r` 在不同 shell 下的解析差异
- `validateZshDangerousCommands`：拦截 Zsh 特有的危险内建（`zmodload`、`ztcp`、`sysopen` 等）
- `validateCommentQuoteDesync`：防注释与引号的解析状态不同步注入

子命令超过 50 个时直接回退到 `ask`（`bashPermissions.ts:103`），防止正则/AST 解析被 ReDoS 攻击打爆。

并发安全判断：只有 `isReadOnly()` 返回 true 的命令允许并行，含 `cd` 的命令不允许（会改变工作目录）。

### 3.4 AgentTool 的上下文隔离

`runAgent.ts` 的 `createSubagentContext` 为子 Agent 创建隔离的执行环境：

| 维度 | 实现 |
|------|------|
| 消息列表 | 独立创建，不引用父对话 |
| 文件状态缓存 | Fork 模式下克隆父级，普通模式下全新创建 |
| AbortController | 异步 Agent 使用独立控制器 |
| 工具池 | 按 Agent 类型独立组装，可配置不同的 permissionMode |
| 思考功能 | 子 Agent 默认关闭（`thinkingConfig: { type: 'disabled' }`） |

子 Agent 的中间过程不混入主对话。结束时结果被序列化为一条 `tool_result` 返回。

### 3.5 工具编排

`toolOrchestration.ts` 将工具调用序列分区为交替的并行/串行批次：连续的 `isConcurrencySafe=true` 工具合并为并行批次（最大并发 10），其余单独成串行批次。

并行批次内的 `contextModifier` 被收集后延迟应用，批次跑完再按原始顺序逐一 apply，避免并发修改状态。

### 3.6 MCPTool 的桥接

`services/mcp/client.ts` 将 MCP 服务器的工具映射为统一的 `Tool` 接口：

```typescript
return { ...MCPTool, name, description, call, checkPermissions: 'passthrough' }
```

MCP 的 `annotations.readOnlyHint` 映射为 `isReadOnly()` / `isConcurrencySafe()`，`destructiveHint` 映射为 `isDestructive()`。权限走通用权限系统（`passthrough`）。

---

## 四、权限与安全系统

核心文件：`utils/permissions/permissions.ts`（~1,300 行）、`tools/BashTool/bashSecurity.ts`（2,592 行）、`utils/hooks.ts`（5,022 行）

### 4.1 权限模式

`types/permissions.ts` 定义了 6 种模式：

| 模式 | 行为 |
|------|------|
| `default` | 每次工具调用都提示用户确认 |
| `acceptEdits` | 文件编辑自动放行，高危操作仍需确认 |
| `auto` | AI 分类器（yoloClassifier）自动判定 |
| `bypassPermissions` | 跳过大部分检查 |
| `plan` | 只读，不执行任何修改操作 |
| `dontAsk` | 不弹窗，所有 `ask` 转为 `deny` |

在 `permissions.ts:1252-1260`，即使 `bypassPermissions` 模式下，deny 规则和 `safetyCheck` 仍然强制执行。safetyCheck 保护 `.git/`、`.claude/`、shell 配置文件等路径。

### 4.2 规则来源与优先级

`permissionsLoader.ts:120` 加载规则的来源：

| 来源 | 说明 |
|------|------|
| `policySettings` | 企业策略（MDM 管理） |
| `userSettings` | `~/.claude/settings.json` |
| `projectSettings` | `.claude/settings.json` |
| `localSettings` | `.claude/settings.local.json` |
| `cliArg` | 命令行参数 |
| `session` | 当前会话 |

`shouldAllowManagedPermissionRulesOnly()` 返回 true 时，只加载 `policySettings`，其他来源全部忽略。

### 4.3 Auto 模式的快速路径

`permissions.ts:596-686` 对 Auto 模式做了三级优化：

1. 先模拟 acceptEdits 模式检查，通过则直接放行（零 API 调用）
2. 再查安全工具白名单（零 API 调用）
3. 以上都未命中，才调 yoloClassifier 做 side query（需要 API 调用）

绝大部分日常操作（文件读写、grep、glob）在前两级就完成判定。

yoloClassifier（`yoloClassifier.ts`）构建上下文时，只提取用户消息和助手的 `tool_use` block，**排除助手文本**（模型生成的内容可能影响分类器决策）。

### 4.4 拒绝限流

`DenialTrackingState` 跟踪连续拒绝次数。达到阈值后自动回退到人工审批模式。headless 模式下直接抛 `AbortError` 终止会话。

### 4.5 Hook 系统

`utils/hooks.ts` 支持 20+ 种生命周期事件（PreToolUse、PostToolUse、SessionStart、PermissionRequest 等）。

PreToolUse hook 接收工具名和输入，通过 stdout 返回 JSON 决策：`allow`（放行）、`deny`（阻断）、`ask`（回退到用户确认）。还支持 `updatedInput` 修改工具输入。

信任安全：所有 hook 要求工作区信任（`shouldSkipHookDueToTrust()`），防止恶意项目通过 `.claude/settings.json` 中的 hook 在未确认信任前执行命令。

---

## 五、多 Agent 协作

核心文件：`tools/AgentTool/AgentTool.tsx`、`tools/AgentTool/runAgent.ts`、`tools/AgentTool/forkSubagent.ts`、`bridge/bridgeMain.ts`（2,999 行）、`coordinator/coordinatorMode.ts`、`tasks/`、`utils/swarm/`

### 5.1 三种 Agent 类型

**SubAgent**：通过 AgentTool 派生，有独立的对话上下文。支持同步和异步执行。

**Fork**：继承父 Agent 的完整上下文（系统提示词 + 对话历史）。`forkSubagent.ts` 的实现有一个关键的缓存优化：Fork 子 Agent 不重新调用 `getSystemPrompt()` 生成提示词，而是直接传递父 Agent 已渲染好的字节。源码注释（`forkSubagent.ts:55-58`）：

> "Reconstructing by re-calling getSystemPrompt() can diverge (GrowthBook cold→warm) and bust the prompt cache"

所有 Fork 子 Agent 的 API 请求前缀字节完全相同，仅最后一个 directive text block 不同。多个并行 Fork 共享同一个 prompt cache 条目。

**Teammate**（Swarm 模式）：独立的团队成员，通过 Mailbox 文件系统通信。

### 5.2 任务类型

`Task.ts:6-13`：

```typescript
export type TaskType =
  | 'local_bash'           // 本地 Shell 命令
  | 'local_agent'          // 本地 Agent（同步/异步）
  | 'remote_agent'         // 远程 Agent（沙箱环境）
  | 'in_process_teammate'  // 进程内队友（AsyncLocalStorage 隔离）
  | 'dream'                // 记忆整合 Agent
```

`dream` 类型是后台自动运行的 Agent，回顾历史会话，将经验整合到 MEMORY.md，分 orient/gather/consolidate/prune 四个阶段。

### 5.3 Swarm 执行后端

`utils/swarm/backends/types.ts` 定义了三种后端：

- **tmux**：通过 tmux 分屏管理多个 Agent 进程
- **iTerm2**：利用 iTerm2 原生 split pane API
- **in-process**：同一 Node.js 进程内，通过 AsyncLocalStorage 隔离

### 5.4 Coordinator 模式

`coordinatorMode.ts` 通过环境变量 `CLAUDE_CODE_COORDINATOR_MODE` 激活。Coordinator 只做三件事：与用户沟通、派发 Worker、综合结果。自己不使用文件/Bash 工具。

Worker 结果以 `<task-notification>` XML 格式作为 user-role 消息注入 Coordinator 的对话流。

Worker 遇到权限提示时，通过 Mailbox 转发给 Leader，Leader 端展示审批对话框。

### 5.5 SendMessageTool 的路由

`tools/SendMessageTool/SendMessageTool.ts` 根据目标自动选择通信方式：

- 进程内 Agent：查 `agentNameRegistry`，运行中的 Agent 接收排队消息，已停止的 Agent 自动恢复（从磁盘 transcript 重建上下文）
- 文件系统 Mailbox：`writeToMailbox()`，支持点对点和广播（`to: "*"`）
- 跨进程/跨机器：通过 Bridge（`bridge:<session-id>`）或 Unix Domain Socket（`uds:<socket-path>`）

---

## 六、系统提示词与记忆系统

核心文件：`constants/prompts.ts`（914 行）、`utils/systemPrompt.ts`（124 行）、`memdir/memdir.ts`、`utils/claudemd.ts`（~1,200 行）、`services/extractMemories/`

### 6.1 提示词构建流程

`buildEffectiveSystemPrompt()`（`utils/systemPrompt.ts:41`）定义了优先级：

```typescript
// 0. overrideSystemPrompt → 完全替换（loop mode 使用）
// 1. coordinator mode → 协调器提示词
// 2. agent definition → 常规模式替换，Proactive 模式追加
// 3. customSystemPrompt → --system-prompt 参数
// 4. defaultSystemPrompt → 标准提示词
```

Proactive/KAIROS 模式下，Agent 指令追加到默认提示词后面（`systemPrompt.ts:103-113`），而不是替换。默认提示词已经包含自主 Agent 身份和基础能力，Agent 定义只需加领域行为。

### 6.2 动态边界标记

`prompts.ts:105-115`：

```typescript
/**
 * Boundary marker separating static (cross-org cacheable) content
 * from dynamic content.
 * Everything BEFORE this marker can use scope: 'global'.
 * Everything AFTER contains user/session-specific content.
 *
 * WARNING: Do not remove or reorder this marker without updating
 * cache logic in: src/utils/api.ts, src/services/api/claude.ts
 */
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY =
  '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'
```

标记将系统提示词切为两段：

- 标记前（~5,000 token 的静态行为指令）：使用 `scope: 'global'` 缓存，Anthropic 基础设施层面跨用户共享
- 标记后（环境信息、记忆、MCP 指令等）：每用户/每会话不同，不走全局缓存

配合 `systemPromptSection()` 的 memoize 机制：动态部分在会话内也只计算一次（`DANGEROUS_uncachedSystemPromptSection()` 标记的除外，如 MCP 指令）。

### 6.3 提示词内容结构

静态部分（标记前）：

- Intro：身份声明 + OWASP 安全指令
- System：输出格式、权限模型、hook 处理、压缩说明
- Doing Tasks：行为约束（约 50 行具体规则）
- Actions：操作安全边界（可逆/不可逆操作的确认协议）
- Using Tools：工具使用优先级（专用工具优于 Bash）
- Tone & Style：风格约束
- Output Efficiency：简洁性要求

动态部分（标记后）：Session Guidance、Memory Prompt（MEMORY.md 索引）、Env Info（CWD/Git/OS/Model/知识截止日期）、MCP Instructions、Token Budget 等。

### 6.4 CLAUDE.md 加载

`utils/claudemd.ts` 定义了四层加载顺序：

| 层次 | 路径 | 场景 |
|------|------|------|
| Managed | `/etc/claude-code/CLAUDE.md` | 企业策略 |
| User | `~/.claude/CLAUDE.md` + `~/.claude/rules/*.md` | 个人偏好 |
| Project | `CLAUDE.md` + `.claude/CLAUDE.md` + `.claude/rules/*.md` | 项目规范（可 Git 跟踪） |
| Local | `CLAUDE.local.md` | 私有覆盖（不入版本控制） |

从根目录到 CWD 逐层向下遍历，越接近 CWD 的优先级越高。支持 `@include` 指令（最深 5 层）和 frontmatter `paths` 字段做条件注入（只在操作匹配路径的文件时才加载）。

### 6.5 MEMORY.md 截断

`memdir/memdir.ts:35-36`：

```typescript
export const MAX_ENTRYPOINT_LINES = 200
export const MAX_ENTRYPOINT_BYTES = 25_000
```

先按行截断（200 行），再按字节截断（25KB，在最近换行符处切割）。MEMORY.md 是索引文件，每行格式 `- [Title](file.md) — one-line hook`。

### 6.6 自动记忆提取

`services/extractMemories/` 在每次完整查询循环结束时（模型产生无工具调用的最终响应），通过 `runForkedAgent` 启动提取 Agent，共享父级的 prompt cache。

提取 Agent 的工具受限：只能 Read/Grep/Glob + 只读 Bash + 只对记忆目录 Write/Edit。如果主 Agent 本轮已经写了记忆文件，跳过提取。

四种记忆类型：user（用户偏好）、feedback（行为反馈）、project（项目上下文）、reference（参考资料）。

记忆检索由 Sonnet 模型完成（不用主模型），从所有记忆文件的 header 中选出最多 5 个最相关的，以 `<system-reminder>` 标签注入用户消息。每文件限制 200 行 / 4KB，会话累计限制 60KB。

### 6.7 行为约束

`getSimpleDoingTasksSection()`（`prompts.ts`）包含约 50 行行为规则，举几条：

- "Don't add features, refactor code, or make improvements beyond what was asked"
- "Three similar lines of code is better than a premature abstraction"
- "Do not propose changes to code you haven't read"

这些规则针对 LLM 在 Agent 场景下常见的过度行为（修 bug 时顺手重构、创建不必要的抽象、对未读代码提出修改）做了明确约束。部分规则标注了 `@[MODEL LAUNCH]`，说明是针对特定模型版本测试后加入的。

---

## 附录：关键文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `query.ts` | 1,729 | 对话循环 |
| `services/api/claude.ts` | 3,419 | API 调用、SSE 解析、重试 |
| `Tool.ts` | 792 | 工具接口定义 |
| `tools/BashTool/bashSecurity.ts` | 2,592 | Bash 安全验证器 |
| `utils/hooks.ts` | 5,022 | Hook 引擎 |
| `utils/permissions/permissions.ts` | ~1,300 | 权限判定 |
| `services/compact/autoCompact.ts` | 351 | 自动压缩决策 |
| `services/compact/compact.ts` | ~2,000 | 完整压缩实现 |
| `bridge/bridgeMain.ts` | 2,999 | 跨进程桥接 |
| `constants/prompts.ts` | 914 | 系统提示词构建 |
| `utils/claudemd.ts` | ~1,200 | CLAUDE.md 加载 |
| `query/tokenBudget.ts` | 93 | Token 预算决策 |
| `screens/REPL.tsx` | 5,005 | REPL 主屏幕 |
