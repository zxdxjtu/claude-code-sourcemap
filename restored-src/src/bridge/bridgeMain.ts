/**
 * Bridge main module — disabled (no-op stubs).
 * All bridge functionality is disabled. Export signatures preserved for import compatibility.
 */

export type BackoffConfig = {
  connInitialMs: number
  connCapMs: number
  connGiveUpMs: number
  generalInitialMs: number
  generalCapMs: number
  generalGiveUpMs: number
  shutdownGraceMs?: number
  stopWorkBaseDelayMs?: number
}

export type ParsedArgs = {
  verbose: boolean
  sandbox: boolean
  debugFile?: string
  sessionTimeoutMs?: number
  permissionMode?: string
  name?: string
  spawnMode: 'single-session' | 'same-dir' | 'worktree' | undefined
  capacity: number | undefined
  createSessionInDir: boolean | undefined
  sessionId?: string
  continueSession: boolean
  help: boolean
  error?: string
}

export type HeadlessBridgeOpts = {
  dir: string
  name?: string
  spawnMode: 'same-dir' | 'worktree'
  capacity: number
  permissionMode?: string
  sandbox: boolean
  sessionTimeoutMs?: number
  createSessionOnStart: boolean
  getAccessToken: () => string | undefined
  onAuth401: (failedToken: string) => Promise<boolean>
  log: (s: string) => void
}

export async function runBridgeLoop(
  ..._args: unknown[]
): Promise<void> {
  // no-op: bridge disabled
}

export function isConnectionError(_err: unknown): boolean {
  return false
}

export function isServerError(_err: unknown): boolean {
  return false
}

export function parseArgs(_args: string[]): ParsedArgs {
  return {
    verbose: false,
    sandbox: false,
    spawnMode: undefined,
    capacity: undefined,
    createSessionInDir: undefined,
    continueSession: false,
    help: false,
    error: 'Bridge mode is not available in this build.',
  }
}

export async function bridgeMain(_args: string[]): Promise<void> {
  console.error('Bridge mode is not available in this build.')
}

export class BridgeHeadlessPermanentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeHeadlessPermanentError'
  }
}

export async function runBridgeHeadless(
  _opts: HeadlessBridgeOpts,
  _signal: AbortSignal,
): Promise<void> {
  throw new BridgeHeadlessPermanentError(
    'Bridge mode is not available in this build.',
  )
}
