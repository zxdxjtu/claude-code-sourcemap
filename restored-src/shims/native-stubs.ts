/**
 * Stubs for native addons and internal packages that are not available
 * in the restored source build.
 */

// color-diff-napi stubs
export class ColorDiff {
  compare() { return { distance: 0 }; }
}
export class ColorFile {
  constructor(_path?: string) {}
}
export function getSyntaxTheme(): any { return {}; }
export type SyntaxTheme = any;

// modifiers-napi stubs
export function prewarm(): void {}
export function isModifierPressed(_modifier: string): boolean { return false; }

// @ant/claude-for-chrome-mcp stubs
export const BROWSER_TOOLS: any[] = [];
export function createClaudeForChromeMcpServer(): any { return {}; }
export type ClaudeForChromeContext = any;
export type Logger = any;

// @anthropic-ai/sandbox-runtime stubs
export class SandboxManager {
  static isSupportedPlatform(): boolean { return false; }
  async initialize(): Promise<void> {}
  async execute(_cmd: string): Promise<any> { return {}; }
}
export class SandboxViolationStore {
  getViolations(): any[] { return []; }
}
export const SandboxRuntimeConfigSchema: any = {};
export type FsReadRestrictionConfig = any;
export type NetworkHostPattern = any;
export type SandboxRuntimeConfig = any;

// @anthropic-ai/mcpb stubs
export function getMcpConfigForManifest(): any { return {}; }
export type McpbManifest = any;
export const McpbManifestSchema: any = {};
export type McpbUserConfigurationOption = any;

// @anthropic-ai/claude-agent-sdk stubs
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';

// @ant/computer-use-mcp stubs
export function createComputerUseMcpServer(): any { return {}; }

// @ant/computer-use-swift stubs
export function createComputerUseSwiftServer(): any { return {}; }
