/**
 * Assistant session history — disabled (no-op stubs).
 * Export signatures preserved for import compatibility.
 */

import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'

export const HISTORY_PAGE_SIZE = 100

export type HistoryPage = {
  events: SDKMessage[]
  firstId: string | null
  hasMore: boolean
}

export type HistoryAuthCtx = {
  baseUrl: string
  headers: Record<string, string>
}

export async function createHistoryAuthCtx(
  _sessionId: string,
): Promise<HistoryAuthCtx> {
  return { baseUrl: '', headers: {} }
}

export async function fetchLatestEvents(
  _ctx: HistoryAuthCtx,
  _limit?: number,
): Promise<HistoryPage | null> {
  return null
}

export async function fetchOlderEvents(
  _ctx: HistoryAuthCtx,
  _beforeId: string,
  _limit?: number,
): Promise<HistoryPage | null> {
  return null
}
