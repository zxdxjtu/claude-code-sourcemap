/**
 * Simplified model module — all model references return 'MiniMax-M2.5'
 * for OpenAI-compatible API via Volcano Engine.
 */

export type ModelShortName = string
export type ModelName = string
export type ModelSetting = ModelName | null

const DEFAULT_MODEL = 'MiniMax-M2.5'

export function getSmallFastModel(): ModelName {
  return process.env.ANTHROPIC_SMALL_FAST_MODEL || DEFAULT_MODEL
}

export function isNonCustomOpusModel(_model: ModelName): boolean {
  return false
}

export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  const modelOverride = process.env.ANTHROPIC_MODEL
  if (modelOverride) return modelOverride
  return undefined
}

export function getMainLoopModel(): ModelName {
  return getUserSpecifiedModelSetting() || DEFAULT_MODEL
}

export function getBestModel(): ModelName {
  return DEFAULT_MODEL
}

export function getDefaultOpusModel(): ModelName {
  return DEFAULT_MODEL
}

export function getDefaultSonnetModel(): ModelName {
  return DEFAULT_MODEL
}

export function getDefaultHaikuModel(): ModelName {
  return DEFAULT_MODEL
}

export function getRuntimeMainLoopModel(_params: {
  permissionMode: string
  mainLoopModel: string
  exceeds200kTokens?: boolean
}): ModelName {
  return _params.mainLoopModel
}

export function getDefaultMainLoopModelSetting(): ModelName {
  return DEFAULT_MODEL
}

export function getDefaultMainLoopModel(): ModelName {
  return DEFAULT_MODEL
}

export function firstPartyNameToCanonical(name: ModelName): ModelShortName {
  return name
}

export function getCanonicalName(fullModelName: ModelName): ModelShortName {
  return fullModelName
}

export function getClaudeAiUserDefaultModelDescription(
  _fastMode = false,
): string {
  return 'MiniMax-M2.5 · OpenAI Compatible'
}

export function renderDefaultModelSetting(setting: ModelName): string {
  return setting
}

export function getOpus46PricingSuffix(_fastMode: boolean): string {
  return ''
}

export function isOpus1mMergeEnabled(): boolean {
  return false
}

export function renderModelSetting(setting: ModelName): string {
  return setting
}

export function getPublicModelDisplayName(model: ModelName): string | null {
  if (model.includes('MiniMax')) return 'MiniMax-M2.5'
  return null
}

export function renderModelName(model: ModelName): string {
  return getPublicModelDisplayName(model) || model
}

export function getPublicModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  if (publicName) return publicName
  return model
}

export function parseUserSpecifiedModel(modelInput: ModelName): ModelName {
  return modelInput.trim().replace(/\[(1|2)m\]$/gi, '')
}

export function resolveSkillModelOverride(
  skillModel: string,
  _currentModel: string,
): string {
  return skillModel
}

export function isLegacyModelRemapEnabled(): boolean {
  return false
}

export function modelDisplayString(model: ModelSetting): string {
  if (model === null) return `Default (${DEFAULT_MODEL})`
  return model
}

export function getMarketingNameForModel(_modelId: string): string | undefined {
  return 'MiniMax-M2.5'
}

export function normalizeModelStringForAPI(model: string): string {
  return model.replace(/\[(1|2)m\]/gi, '')
}
