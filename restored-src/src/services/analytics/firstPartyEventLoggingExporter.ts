/**
 * First-party event logging exporter - DISABLED (no-op implementation)
 */

import type { ExportResult } from '@opentelemetry/core'
import { ExportResultCode } from '@opentelemetry/core'
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs'

export class FirstPartyEventLoggingExporter implements LogRecordExporter {
  constructor(_options: Record<string, unknown> = {}) {}

  async getQueuedEventCount(): Promise<number> {
    return 0
  }

  async export(
    _logs: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): Promise<void> {
    resultCallback({ code: ExportResultCode.SUCCESS })
  }

  async shutdown(): Promise<void> {}

  async forceFlush(): Promise<void> {}
}
