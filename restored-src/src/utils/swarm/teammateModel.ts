import { MINIMAX_CONFIG } from '../model/configs.js'

// Teammate model fallback — always MiniMax-M2.5
export function getHardcodedTeammateModelFallback(): string {
  return MINIMAX_CONFIG.firstParty
}
