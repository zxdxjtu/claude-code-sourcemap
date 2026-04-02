export type ModelName = string

export type ModelConfig = {
  firstParty: string
  bedrock: string
  vertex: string
  foundry: string
}

// Single model configuration for MiniMax-M2.5
export const MINIMAX_CONFIG = {
  firstParty: 'MiniMax-M2.5',
  bedrock: 'MiniMax-M2.5',
  vertex: 'MiniMax-M2.5',
  foundry: 'MiniMax-M2.5',
} as const satisfies ModelConfig

export const ALL_MODEL_CONFIGS = {
  minimax: MINIMAX_CONFIG,
} as const satisfies Record<string, ModelConfig>

export type ModelKey = keyof typeof ALL_MODEL_CONFIGS

export type CanonicalModelId =
  (typeof ALL_MODEL_CONFIGS)[ModelKey]['firstParty']

export const CANONICAL_MODEL_IDS = Object.values(ALL_MODEL_CONFIGS).map(
  c => c.firstParty,
) as [CanonicalModelId, ...CanonicalModelId[]]

export const CANONICAL_ID_TO_KEY: Record<CanonicalModelId, ModelKey> =
  Object.fromEntries(
    (Object.entries(ALL_MODEL_CONFIGS) as [ModelKey, ModelConfig][]).map(
      ([key, cfg]) => [cfg.firstParty, key],
    ),
  ) as Record<CanonicalModelId, ModelKey>

// Context window and output token limits for MiniMax-M2.5
export const MODEL_CONTEXT_WINDOW = 1_000_000
export const MODEL_MAX_OUTPUT_TOKENS = 16384
