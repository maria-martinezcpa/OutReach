import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { api, type SuggestField, type Suggestion } from '../api'
import { input } from './ui'

interface Props {
  field: SuggestField
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label: string
  /** When set, picking a suggestion, Enter or a comma "commits" the value (e.g. adds a keyword chip). */
  onCommit?: (value: string) => void
  /** Backspace in an empty box (e.g. removes the last chip). */
  onBackspaceEmpty?: () => void
}

/** Text input with a dropdown of values GitHub search understands (topics, languages, locations…). */
export default function Autocomplete({ field, value, onChange, placeholder, label, onCommit, onBackspaceEmpty }: Props) {
  const [items, setItems] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const typed = useRef(false)
  const request = useRef(0)
  const listId = useId()

  useEffect(() => {
    if (!typed.current) return
    const q = value.trim()
    if (!q) {
      setItems([])
      return
    }
    const id = ++request.current
    const timer = setTimeout(() => {
      api
        .suggest(field, q)
        .then((res) => {
          if (id !== request.current) return // a newer keystroke already asked again
          setItems(res)
          setActive(-1)
          setOpen(res.length > 0)
        })
        .catch(() => {})
    }, 180)
    return () => clearTimeout(timer)
  }, [field, value])

  function pick(s: Suggestion) {
    typed.current = false
    if (onCommit) {
      onCommit(s.value)
      setItems([])
    } else onChange(s.value)
    setOpen(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (onCommit) {
      const enterWithoutChoice = e.key === 'Enter' && !(open && active >= 0)
      if ((enterWithoutChoice || e.key === ',') && value.trim()) {
        e.preventDefault() // add the keyword instead of submitting the form
        onCommit(value.trim())
        setOpen(false)
        setItems([])
        return
      }
      if (e.key === 'Backspace' && !value && onBackspaceEmpty) {
        onBackspaceEmpty()
        return
      }
    }
    if (!open || !items.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault() // choose the suggestion instead of submitting the form
      pick(items[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <input
        className={input}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(e) => {
          typed.current = true
          onChange(e.target.value)
        }}
        onFocus={() => items.length && typed.current && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-72 w-full min-w-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {items.map((s, i) => (
            <li
              key={s.value}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s)
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-indigo-50' : ''}`}
            >
              <div className="font-medium text-slate-800">
                {s.value}
                {s.label && s.label.toLowerCase() !== s.value.toLowerCase() && (
                  <span className="ml-1.5 font-normal text-slate-500">{s.label}</span>
                )}
              </div>
              {s.hint && <div className="truncate text-xs text-slate-500">{s.hint}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
