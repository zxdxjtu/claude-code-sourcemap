/**
 * Computer Use gates — disabled (no-op stubs).
 * Export signatures preserved for import compatibility.
 */

import type { CoordinateMode, CuSubGates } from '@ant/computer-use-mcp/types'

export function getChicagoEnabled(): boolean {
  return false
}

export function getChicagoSubGates(): CuSubGates {
  return {
    pixelValidation: false,
    clipboardPasteMultiline: true,
    mouseAnimation: true,
    hideBeforeAction: true,
    autoTargetDisplay: true,
    clipboardGuard: true,
  }
}

export function getChicagoCoordinateMode(): CoordinateMode {
  return 'pixels'
}
