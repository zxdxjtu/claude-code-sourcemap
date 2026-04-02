/**
 * Bridge mode — disabled (no-op stubs).
 * All functions return disabled/false to prevent any bridge functionality.
 * Export signatures preserved for import compatibility.
 */

export function isBridgeEnabled(): boolean {
  return false
}

export async function isBridgeEnabledBlocking(): Promise<boolean> {
  return false
}

export async function getBridgeDisabledReason(): Promise<string | null> {
  return 'Remote Control is not available in this build.'
}

export function isEnvLessBridgeEnabled(): boolean {
  return false
}

export function isCseShimEnabled(): boolean {
  return true
}

export function checkBridgeMinVersion(): string | null {
  return null
}

export function getCcrAutoConnectDefault(): boolean {
  return false
}

export function isCcrMirrorEnabled(): boolean {
  return false
}
