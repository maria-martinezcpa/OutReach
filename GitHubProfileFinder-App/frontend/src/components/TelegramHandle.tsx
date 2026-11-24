import { useState } from 'react'

/** "@username" from a https://t.me/<username> link. */
export const telegramHandle = (url: string) => '@' + url.replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i, '').replace(/\/$/, '')

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older embedded browsers: fall back to a hidden text field.
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    el.remove()
    return ok
  }
}

/** Telegram username that copies itself on one click, with a small link to open the chat. */
export default function TelegramHandle({ url }: { url: string }) {
  const handle = telegramHandle(url)
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (await copyText(handle)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={copy}
        title="Click to copy"
        aria-label={`Copy Telegram username ${handle}`}
        className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-px font-medium text-sky-800 ring-1 ring-inset ring-sky-200 hover:bg-sky-100"
      >
        {handle}
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 opacity-70">
          {copied
            ? <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
            : <path d="M7 3a2 2 0 00-2 2v1H4a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-1h1a2 2 0 002-2V5a2 2 0 00-2-2H7zm7 11V8a2 2 0 00-2-2H7V5h8v9h-1zM4 8h8v8H4V8z" />}
        </svg>
      </button>
      {copied && <span role="status" className="text-[11px] text-emerald-700">Copied</span>}
      <a href={url} target="_blank" rel="noreferrer" title="Open chat in Telegram" className="text-[11px] text-indigo-700 hover:underline">open</a>
    </span>
  )
}
