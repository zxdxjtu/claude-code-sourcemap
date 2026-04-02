/**
 * Buddy prompt module — disabled (no-op stubs).
 * Export signatures preserved for import compatibility.
 */

import type { Message } from '../types/message.js'
import type { Attachment } from '../utils/attachments.js'

export function companionIntroText(_name: string, _species: string): string {
  return ''
}

export function getCompanionIntroAttachment(
  _messages: Message[] | undefined,
): Attachment[] {
  return []
}
