import { api } from './api'
import { buildDraft, type DraftSettings } from './draft'
import type { SavedEntry } from './types'

/** Opens one draft link in the user's app. The desktop window can't open mailto:/tg: links itself, so the
 *  backend hands them to Windows; in a normal browser (or if that fails) the browser tries instead. */
export async function openDraftUrl(url: string): Promise<boolean> {
  try {
    await api.openUrl(url)
    return true
  } catch {
    return !!window.open(url, '_blank')
  }
}

/** Opens the draft for one person in the queue; false if it can't be made or opened. */
export async function openQueueDraft(entry: SavedEntry | undefined, settings: DraftSettings, templateId: string) {
  const draft = entry && buildDraft(entry.profile, settings, templateId).draft
  return draft ? openDraftUrl(draft.url) : false
}
