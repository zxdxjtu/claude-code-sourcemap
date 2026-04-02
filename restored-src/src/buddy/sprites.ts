/**
 * Buddy sprites module — disabled (no-op stubs).
 * Export signatures preserved for import compatibility.
 */

import type { CompanionBones, Species } from './types.js'

export function renderSprite(_bones: CompanionBones, _frame = 0): string[] {
  return []
}

export function spriteFrameCount(_species: Species): number {
  return 0
}

export function renderFace(_bones: CompanionBones): string {
  return ''
}
