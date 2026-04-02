/**
 * Buddy notification module — disabled (no-op stubs).
 * Export signatures preserved for import compatibility.
 */

export function isBuddyTeaserWindow(): boolean {
  return false
}

export function isBuddyLive(): boolean {
  return false
}

export function useBuddyNotification(): void {
  // no-op
}

export function findBuddyTriggerPositions(
  _text: string,
): Array<{ start: number; end: number }> {
  return []
}
