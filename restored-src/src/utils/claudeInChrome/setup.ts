/**
 * Claude in Chrome setup — disabled (no-op stubs).
 * Export signatures preserved for import compatibility.
 */

import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'

export function shouldEnableClaudeInChrome(_chromeFlag?: boolean): boolean {
  return false
}

export function shouldAutoEnableClaudeInChrome(): boolean {
  return false
}

export function setupClaudeInChrome(): {
  mcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
  systemPrompt: string
} {
  return { mcpConfig: {}, allowedTools: [], systemPrompt: '' }
}

export async function installChromeNativeHostManifest(): Promise<void> {
  // no-op
}

export async function isChromeExtensionInstalled(): Promise<boolean> {
  return false
}
