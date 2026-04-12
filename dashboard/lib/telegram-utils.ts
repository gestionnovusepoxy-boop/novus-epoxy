/**
 * Returns current hour in Quebec timezone (0-23)
 */
export function getQuebecHour(): number {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Montreal',
    hour: 'numeric',
    hour12: false
  }).replace(/\D/g, '') as unknown as number;
}

/**
 * Returns true if it's quiet hours in Quebec (21h-7h)
 * During quiet hours, Telegram messages should NOT be sent
 */
export function isQuietHours(): boolean {
  const h = getQuebecHour();
  return h >= 21 || h < 7;
}

/**
 * Send a Telegram message, but only during business hours (8h-21h Quebec).
 * Returns true if message was sent, false if suppressed due to quiet hours.
 * If force=true, sends regardless of time (for critical alerts like payment confirmations).
 */
export async function sendTelegramSafe(
  chatId: string,
  text: string,
  options?: { parse_mode?: string; reply_markup?: unknown; force?: boolean }
): Promise<boolean> {
  if (!options?.force && isQuietHours()) return false;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options?.parse_mode || 'HTML',
        ...(options?.reply_markup ? { reply_markup: options.reply_markup } : {}),
      }),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get all admin chat IDs from environment
 */
export function getAdminChatIds(): string[] {
  const group = process.env.TELEGRAM_GROUP_CHAT_ID;
  if (group) return [group];
  return (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
}
