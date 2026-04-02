/**
 * Simplified model strings module — returns MiniMax-M2.5 for all keys.
 */

import { ALL_MODEL_CONFIGS, type ModelKey } from './configs.js'

export type ModelStrings = Record<ModelKey, string>

const MODEL_KEYS = Object.keys(ALL_MODEL_CONFIGS) as ModelKey[]

function getDefaultModelStrings(): ModelStrings {
  const out = {} as ModelStrings
  for (const key of MODEL_KEYS) {
    out[key] = ALL_MODEL_CONFIGS[key].firstParty
  }
  return out
}

export function resolveOverriddenModel(modelId: string): string {
  return modelId
}

export function getModelStrings(): ModelStrings {
  return getDefaultModelStrings()
}

export async function ensureModelStringsInitialized(): Promise<void> {
  // No-op — single model, no async init needed
}

// Re-export parseUserSpecifiedModel and normalizeModelStringForAPI
// from model.ts for backward compatibility of import paths
export { parseUserSpecifiedModel, normalizeModelStringForAPI } from './model.js'
