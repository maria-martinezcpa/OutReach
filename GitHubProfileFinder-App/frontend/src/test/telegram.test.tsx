import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TelegramHandle, { telegramHandle } from '../components/TelegramHandle'

describe('TelegramHandle', () => {
  it('turns a t.me link into @username', () => {
    expect(telegramHandle('https://t.me/dana_s')).toBe('@dana_s')
    expect(telegramHandle('https://telegram.me/dana_s/')).toBe('@dana_s')
  })

  it('shows the username and copies it on one click', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<TelegramHandle url="https://t.me/dana_s" />)
    await user.click(screen.getByRole('button', { name: 'Copy Telegram username @dana_s' }))
    expect(writeText).toHaveBeenCalledWith('@dana_s')
    expect(await screen.findByText('Copied')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'open' }).getAttribute('href')).toBe('https://t.me/dana_s')
  })
})
