/**
 * Buddy companion module — disabled (no-op stubs).
 * Export signatures preserved for import compatibility.
 */

import type { Companion } from './types.js'

export type Roll = {
  bones: import('./types.js').CompanionBones
  inspirationSeed: number
}

export function roll(_userId: string): Roll {
  return { bones: {} as Roll['bones'], inspirationSeed: 0 }
}

export function rollWithSeed(_seed: string): Roll {
  return { bones: {} as Roll['bones'], inspirationSeed: 0 }
}

export function companionUserId(): string {
  return 'anon'
}

export function getCompanion(): Companion | undefined {
  return undefined
}
