/**
 * Datadog analytics - DISABLED (all functions are no-op)
 */

export async function initializeDatadog(): Promise<boolean> {
  return false
}

export async function shutdownDatadog(): Promise<void> {}

export async function trackDatadogEvent(
  _eventName: string,
  _properties: { [key: string]: boolean | number | undefined },
): Promise<void> {}
