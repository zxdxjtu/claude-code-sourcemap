# Claude Code 2.1.88 还原版 — 不可用功能深度分析

还原过程中，对"无源码"问题采取了**三层降级策略**：

```
第一层：完整恢复（sourcemap 还原的内部 SDK）
       ↓ 不行
第二层：运行时 Stub（保留接口签名，返回降级值）
       ↓ 不行
第三层：强制禁用（feature flag = false，直接跳过代码路径）
```

---

## 一、Stub 无源码 — 工具类（`isEnabled()=false`，从 AI 工具列表彻底消失）

| 功能模块 | 文件路径 | 原因 | 降级方式 | 影响面详述 |
|---------|---------|------|---------|-----------|
| **TungstenTool** | `src/tools/TungstenTool/TungstenTool.ts` | Stub 无源码 | `isEnabled()=false`，且仅 `USER_TYPE=ant` 时才注册 | 基于 tmux 的持久化虚拟终端工具不可用。AI 无法在同一个 shell 中跨多次调用保持状态（环境变量、进程、工作目录），无法运行交互式程序（如 vim、python REPL）。普通用户从未暴露此工具，**无感知** |
| **TungstenLiveMonitor** | `src/tools/TungstenTool/TungstenLiveMonitor.tsx` | Stub 无源码 | 返回 `null` | TUI 界面中的 Tungsten 终端实时输出监控面板不渲染。依赖 TungstenTool，一并失效，**无感知** |
| **REPLTool** | `src/tools/REPLTool/REPLTool.ts` | Stub 无源码 | `isEnabled()=false`，且仅 `USER_TYPE=ant` 时才注册 | REPL 批处理容器不可用。REPL 模式下 AI 本可以将 Bash/Read/Edit/Glob/Grep 等 8 个工具打包进一次调用批量执行，减少 API 往返。失效后 AI 只能逐个工具单独调用，**效率降低但功能完整** |
| **VerifyPlanExecutionTool** | `src/tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.ts` | Stub 无源码 | `isEnabled()=false` | 计划执行验证工具不可用。AI 无法在执行 Plan 后自动验证执行结果是否符合计划。用户需手动检查，**对代码质量保障有影响** |
| **SuggestBackgroundPRTool** | `src/tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.ts` | Stub 无源码 | `isEnabled()=false` | 后台 PR 建议工具不可用。AI 无法在后台分析代码并主动建议创建 PR。**仅 Ant 内部功能，无感知** |
| **WorkflowTool** | `src/tools/WorkflowTool/constants.ts` | Stub 无源码 + feature flag `WORKFLOW_SCRIPTS` 禁用 | 仅保留工具名常量 | 工作流脚本自动化不可用。AI 无法执行预定义的工作流脚本序列。**实验性功能，依赖内部基础设施** |

---

## 二、Stub 无源码 — 上下文压缩/Token 效率服务（透传不崩溃，但长对话退化严重）

| 功能模块 | 文件路径 | 原因 | 降级方式 | 影响面详述 |
|---------|---------|------|---------|-----------|
| **Snip Compact（历史裁剪）** | `src/services/compact/snipCompact.ts` | Stub 无源码 | `isSnipRuntimeEnabled()=false`，`snipCompactIfNeeded()` 原样返回消息不做裁剪 | 对话历史无法自动裁剪旧消息。**长对话中 token 累积更快，更早触发上下文窗口溢出**，用户需更频繁手动执行 `/compact` |
| **Cached Microcompact（缓存感知微压缩）** | `src/services/compact/cachedMicrocompact.ts` | Stub 无源码 | `isCachedMicrocompactEnabled()=false`，`createCacheEditsBlock()` 返回空 edits | Anthropic API 的 prompt cache 编辑优化不可用。正常情况下该功能可以通过 cache edits 局部更新缓存中的消息，避免重新缓存整个上下文。失效后**每次压缩后 prompt cache 命中率下降，API 成本增加、延迟增高** |
| **Context Collapse（上下文折叠）** | `src/services/contextCollapse/index.ts` | Stub 无源码 | `applyCollapsesIfNeeded()` 原样返回消息，`recoverFromOverflow()` 不做恢复 | **最关键的退化**：正常情况下，旧对话段会被自动折叠成摘要释放 token 空间。失效后上下文窗口永远不会自动折叠，`CONTEXT_WINDOW_EXCEEDED` 错误出现频率大幅增加。配合 snipCompact 同时失效，**长对话可用性严重下降** |

---

## 三、二方包（内部 npm 包 + 原生 C++ addon）— 通过 Bun 插件统一重定向到 `shims/native-stubs.ts`

| 包名 | 类型 | 降级方式 | 影响面详述 |
|------|------|---------|-----------|
| **`@anthropic-ai/sandbox-runtime`** | 内部二方包 | `SandboxManager.isSupportedPlatform()=false`，所有沙箱相关代码走"非沙箱分支" | **安全性影响最大**：工具执行（Bash/FileEdit 等）失去沙箱隔离保护。正式版中，AI 执行的 shell 命令会在沙箱内运行，限制文件系统/网络访问。失效后所有命令直接在宿主机执行，一个恶意或错误的 `rm -rf` 无任何拦截。权限系统仍在但缺少底层强制执行层 |
| **`@anthropic-ai/mcpb`** | 内部二方包 | `getMcpConfigForManifest()={}` | MCPB（MCP Bundle）托管 MCP 服务器配置加载失败。通过 Anthropic 平台托管的 MCP 服务器无法自动发现和连接。用户仍可手动配置 MCP 服务器（stdio/SSE/HTTP），**仅影响 Anthropic 平台托管的自动发现** |
| **`@anthropic-ai/claude-agent-sdk`** | 内部二方包 | 仅保留 `PermissionMode` 类型定义 | 外部 Agent SDK 集成不可用。通过 SDK 启动的 Claude Code 会话无法被外部程序以 Agent 模式驱动。**不影响 CLI 交互使用，仅影响 SDK 编程集成场景** |
| **`@ant/claude-for-chrome-mcp`** | 内部二方包 | `BROWSER_TOOLS=[]` 空数组，`createClaudeForChromeMcpServer()={}` | Chrome 浏览器集成 MCP 工具集全部不可用。AI 无法通过 Chrome 扩展操作浏览器（打开页面、点击、截图等）。**与 `WEB_BROWSER_TOOL` feature flag 不同，后者使用独立的 Puppeteer 实现仍可用** |
| **`@ant/computer-use-mcp`** | 内部二方包 | `createComputerUseMcpServer()={}` | Computer Use（计算机使用）MCP 服务器无法启动。AI 无法通过 MCP 协议操控桌面——移动鼠标、截屏、键盘输入等。**这是 Anthropic 的 Computer Use 功能的 MCP 封装** |
| **`@ant/computer-use-swift`** | 内部二方包 | `createComputerUseSwiftServer()={}` | macOS 原生 Computer Use 不可用。这是 Computer Use 的 macOS Swift 原生实现，通过 Accessibility API 操控系统界面。性能优于通用 MCP 版本，**失效后即使 Computer Use MCP 可用也没有原生加速** |
| **`color-diff-napi`** | C++ 原生 addon | `ColorDiff.compare()={distance:0}`，`getSyntaxTheme()={}` | 语法高亮颜色差值计算失效。该 addon 用于比较终端颜色与语法主题颜色的距离，找到最佳匹配。失效后**代码语法高亮颜色映射可能不精确**，但不影响功能只影响视觉效果 |
| **`modifiers-napi`** | C++ 原生 addon | `isModifierPressed()=false`，`prewarm()=noop` | 键盘修饰键实时检测失效。该 addon 通过系统 API 检测 Shift/Ctrl/Alt/Meta 是否按下。失效后**某些快捷键组合（如 Shift+Enter 换行）可能行为异常**，TUI 退化为仅基于终端转义序列的按键检测 |

---

## 四、Stub 无源码 — Assistant/KAIROS 系统（整体被 DCE 移除）

| 功能模块 | 文件路径 | 原因 | 降级方式 | 影响面详述 |
|---------|---------|------|---------|-----------|
| **AssistantSessionChooser** | `src/assistant/AssistantSessionChooser.tsx` | Stub 无源码 + feature flag `KAIROS` 禁用 | `useEffect→onCancel()` 立即取消 | Bridge 会话选择 UI 不渲染，立即退出。KAIROS 模式中用于选择要连接的远程会话。**整个 KAIROS 助手模式不可用** |
| **Session Discovery** | `src/assistant/sessionDiscovery.ts` | Stub 无源码 | `discoverAssistantSessions()=[]` | 永远发现不到任何可用的 Assistant 会话。依赖 KAIROS 基础设施，**一并失效** |
| **`/assistant` 命令** | `src/commands/assistant/index.ts` | Stub 无源码 | `isEnabled()=false`，`isHidden=true` | 斜杠命令从命令列表中隐藏且不可用。无法启动 KAIROS 助手模式。**整个 KAIROS 系统 6 个 feature flag 全部禁用** |
| **`/agents-platform` 命令** | `src/commands/agents-platform/index.ts` | Stub 无源码 | `isEnabled()=false`，`isHidden=true` | Anthropic 内部 Agents Platform 管理命令不可用。用于管理部署在 Anthropic 平台上的 Agent 实例 |

---

## 五、Feature Flag 禁用 — 源码存在但通过 `shims/bun-bundle.ts` 关闭（代码路径被跳过）

| Feature Flag | 原因 | 影响面详述 |
|-------------|------|-----------|
| **`COORDINATOR_MODE`** | 源码完整（370 行），但依赖内部基础设施 | 多 Worker 协调模式不可用。该模式下 AI 从"直接执行者"变为"调度者"，可并行派发多个 Worker 研究/实现/验证。**这是 Claude Code 最强大的并行工作模式**——coordinator 负责任务分解和综合，workers 并行执行。失效后只能使用普通单 Agent + 串行 SubAgent |
| **`KAIROS`** 及 `KAIROS_BRIEF/CHANNELS/DREAM/GITHUB_WEBHOOKS/PUSH_NOTIFICATION` | 源文件被 DCE 移除 | KAIROS 是 Anthropic 内部的 AI 助手持久模式。可后台持续运行、接收 GitHub Webhook、推送通知、管理多频道。**类似一个永不下线的 AI 同事** |
| **`DAEMON`** | 内部基础设施 | 后台守护进程模式不可用。Claude Code 无法作为系统服务持久运行 |
| **`BRIDGE_MODE`** | 依赖 `claude-agent-sdk` | 桥接模式不可用。无法将 Claude Code 作为远程 Agent 被其他系统调用 |
| **`BUDDY`** | 内部功能 | AI 伴侣 UI 不可用。一种更轻量的交互界面，以虚拟角色形式呈现 |
| **`SSH_REMOTE`** | 内部基础设施 | SSH 远程连接模式不可用。无法远程连接到另一台机器上的 Claude Code 实例 |
| **`PROACTIVE`** | 内部实验 | 主动式辅助不可用。AI 无法在用户未提问时主动提出建议或发现问题 |
| **`PERFETTO_TRACING`** | 内部调试 | Perfetto 性能追踪不可用。无法生成 Chrome trace viewer 格式的性能分析数据 |
| **`ANTI_DISTILLATION_CC`** | 内部安全 | 反蒸馏保护不可用。防止模型输出被用于训练竞品模型的保护措施 |
| **`NATIVE_CLIENT_ATTESTATION`** | 内部安全 | 原生客户端认证不可用。通过二进制签名验证客户端身份的机制 |

---

## 六、Stub 无源码 — 其他模块（类型/UI/工具类）

| 功能模块 | 文件路径 | 原因 | 降级方式 | 影响面详述 |
|---------|---------|------|---------|-----------|
| **ConnectorText** | `src/types/connectorText.ts` | Stub 无源码 | 保留类型定义和 `isConnectorTextBlock()` 类型守卫 | 内部 Connector 系统的文本块类型。Connector 用于将外部数据源（如 Jira、Slack）集成到对话中。**失效后无法解析 connector 返回的富文本块，但基础消息流不受影响** |
| **SnapshotUpdateDialog** | `src/components/agents/SnapshotUpdateDialog.tsx` | Stub 无源码 | `useEffect→onComplete('keep')` 立即选择"保留" | Agent 记忆快照更新对话框不渲染。当 Agent 记忆快照有更新时，本应弹出对话框让用户选择 merge/keep/replace。**失效后永远自动选择 keep（保留旧快照），新的记忆快照不会被合并** |
| **Protected Namespace** | `src/utils/protectedNamespace.ts` | Stub 无源码 | `checkProtectedNamespace()=false` | 受保护命名空间检查不生效。Anthropic 内部用于防止在受保护的代码区域（如核心 SDK）中操作。**对外部用户无影响** |
| **SDK Runtime Types** | `src/entrypoints/sdk/runtimeTypes.ts` | Stub 无源码（手动重建） | 手工根据调用方签名重建了完整的类型定义（144 行） | **无运行时影响**。纯 TypeScript 类型在编译后消失。但如果第三方通过 SDK 集成，类型签名可能与原版略有偏差 |
| **SDK Tool Types** | `src/entrypoints/sdk/toolTypes.ts` | Stub 无源码 | 仅保留 `ToolDefinition` 和 `ToolResult` 最小接口定义 | **无运行时影响**。纯类型定义 |
| **coreTypes.generated.ts** | `src/entrypoints/sdk/coreTypes.generated.ts` | 原需代码生成器（不存在），改用 `z.infer<>` 反推 | 从 Zod schema 推断出 ~120 个类型 | **无运行时影响**。`z.infer<>` 产生的类型与代码生成器产生的类型完全等价 |
| **React Devtools** | `src/ink/devtools.ts` | Stub 无源码 | `try/catch` 静默跳过 | 仅开发模式下的 React Devtools 连接功能。生产使用**完全无影响** |

---

## 七、影响面总结

| 影响等级 | 功能类别 | 代表功能 | 对日常使用的实际感受 |
|---------|---------|---------|-------------------|
| **严重** | 上下文管理 | Context Collapse + Snip Compact + Cached Microcompact | 长对话（50+ 轮）显著退化，更快耗尽上下文窗口，prompt cache 效率降低 |
| **严重** | 安全隔离 | Sandbox Runtime | 所有工具执行无沙箱保护，命令直接在宿主机运行 |
| **中等** | 并行工作模式 | Coordinator Mode | 无法使用多 Worker 并行研究/实现/验证的高效模式 |
| **低** | 内部工具 | Tungsten/REPL/VerifyPlan | 仅 Anthropic 内部员工使用，外部用户无感知 |
| **低** | 平台集成 | KAIROS/Bridge/Daemon/Computer Use | Anthropic 平台专属功能，独立 CLI 使用不涉及 |
| **无** | 类型系统 | coreTypes/runtimeTypes/toolTypes | 编译后消失的纯 TypeScript 类型，零运行时影响 |
