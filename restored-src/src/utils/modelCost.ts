import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import { logEvent } from 'src/services/analytics/index.js'
import { setHasUnknownModelCost } from '../bootstrap/state.js'
import { isFastModeEnabled } from './fastMode.js'
import { MINIMAX_CONFIG } from './model/configs.js'
import {
  firstPartyNameToCanonical,
  getCanonicalName,
  getDefaultMainLoopModelSetting,
  type ModelShortName,
} from './model/model.js'

// @see https://platform.claude.com/docs/en/about-claude/pricing
export type ModelCosts = {
  inputTokens: number
  outputTokens: number
  promptCacheWriteTokens: number
  promptCacheReadTokens: number
  webSearchRequests: number
}

// Default pricing tier for MiniMax-M2.5
export const COST_TIER_DEFAULT = {
  inputTokens: 3,
  outputTokens: 15,
  promptCacheWriteTokens: 3.75,
  promptCacheReadTokens: 0.3,
  webSearchRequests: 0.01,
} as const satisfies ModelCosts

// Aliases for backward compatibility with modelOptions.ts
export const COST_TIER_3_15 = COST_TIER_DEFAULT
export const COST_HAIKU_35 = COST_TIER_DEFAULT
export const COST_HAIKU_45 = COST_TIER_DEFAULT

const DEFAULT_UNKNOWN_MODEL_COST = COST_TIER_DEFAULT

/**
 * Get cost tier (simplified — single model, no fast mode distinction).
 */
export function getOpus46CostTier(_fastMode: boolean): ModelCosts {
  return COST_TIER_DEFAULT
}

// Model cost mapping — only MiniMax-M2.5
export const MODEL_COSTS: Record<ModelShortName, ModelCosts> = {
  [firstPartyNameToCanonical(MINIMAX_CONFIG.firstParty)]: COST_TIER_DEFAULT,
}

/**
 * Calculates the USD cost based on token usage and model cost configuration
 */
function tokensToUSDCost(modelCosts: ModelCosts, usage: Usage): number {
  return (
    (usage.input_tokens / 1_000_000) * modelCosts.inputTokens +
    (usage.output_tokens / 1_000_000) * modelCosts.outputTokens +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
      modelCosts.promptCacheReadTokens +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) *
      modelCosts.promptCacheWriteTokens +
    (usage.server_tool_use?.web_search_requests ?? 0) *
      modelCosts.webSearchRequests
  )
}

export function getModelCosts(model: string, usage: Usage): ModelCosts {
  const shortName = getCanonicalName(model)

  const costs = MODEL_COSTS[shortName]
  if (!costs) {
    trackUnknownModelCost(model, shortName)
    return (
      MODEL_COSTS[getCanonicalName(getDefaultMainLoopModelSetting())] ??
      DEFAULT_UNKNOWN_MODEL_COST
    )
  }
  return costs
}

function trackUnknownModelCost(model: string, shortName: ModelShortName): void {
  logEvent('tengu_unknown_model_cost', {
    model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    shortName:
      shortName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  setHasUnknownModelCost()
}

// Calculate the cost of a query in US dollars.
// If the model's costs are not found, use the default model's costs.
export function calculateUSDCost(resolvedModel: string, usage: Usage): number {
  const modelCosts = getModelCosts(resolvedModel, usage)
  return tokensToUSDCost(modelCosts, usage)
}

/**
 * Calculate cost from raw token counts without requiring a full BetaUsage object.
 * Useful for side queries (e.g. classifier) that track token counts independently.
 */
export function calculateCostFromTokens(
  model: string,
  tokens: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
  },
): number {
  const usage: Usage = {
    input_tokens: tokens.inputTokens,
    output_tokens: tokens.outputTokens,
    cache_read_input_tokens: tokens.cacheReadInputTokens,
    cache_creation_input_tokens: tokens.cacheCreationInputTokens,
  } as Usage
  return calculateUSDCost(model, usage)
}

function formatPrice(price: number): string {
  if (Number.isInteger(price)) {
    return `$${price}`
  }
  return `$${price.toFixed(2)}`
}

/**
 * Format model costs as a pricing string for display
 * e.g., "$3/$15 per Mtok"
 */
export function formatModelPricing(costs: ModelCosts): string {
  return `${formatPrice(costs.inputTokens)}/${formatPrice(costs.outputTokens)} per Mtok`
}

/**
 * Get formatted pricing string for a model
 * Accepts either a short name or full model name
 * Returns undefined if model is not found
 */
export function getModelPricingString(model: string): string | undefined {
  const shortName = getCanonicalName(model)
  const costs = MODEL_COSTS[shortName]
  if (!costs) return undefined
  return formatModelPricing(costs)
}
