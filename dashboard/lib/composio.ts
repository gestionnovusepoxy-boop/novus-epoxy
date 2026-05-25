import { Composio } from '@composio/core';

export const COMPOSIO_USER_ID = 'novusepoxy-admin';

let _client: Composio | null = null;

export function getComposio(): Composio {
  if (!_client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) throw new Error('COMPOSIO_API_KEY manquant');
    _client = new Composio({ apiKey });
  }
  return _client;
}

/** Get a user session (recommended pattern per Composio v0.10) */
export function getSession() {
  return getComposio().create({ user_id: COMPOSIO_USER_ID });
}

/**
 * Execute a Composio action directly.
 * Tries session.executeAction first, falls back to composio.tools.execute.
 */
export async function runAction(
  action: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const composio = getComposio();
    // Try new session API first
    try {
      const session = getSession();
      const result = await (session as unknown as {
        executeAction: (name: string, input: unknown) => Promise<{ successful?: boolean; data?: unknown; error?: unknown }>
      }).executeAction(action, args);
      if (result?.successful !== false) return { ok: true, data: result?.data ?? result };
      return { ok: false, error: String(result?.error ?? 'Action failed') };
    } catch {
      // Fallback to direct tools.execute
      const result = await composio.tools.execute(action, {
        userId: COMPOSIO_USER_ID,
        arguments: args,
      });
      if (result.successful) return { ok: true, data: result.data };
      return { ok: false, error: String(result.error ?? 'Action failed') };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Get Composio tools for Vercel AI SDK streaming agents.
 * Returns tools compatible with generateText/streamText.
 */
export async function getVercelTools(toolkits: string[]): Promise<Record<string, unknown>> {
  try {
    const { composioVercelTools } = await import('@composio/vercel');
    const session = getSession();
    const tools = await composioVercelTools(session as never, { toolkits });
    return (tools as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

/**
 * Get raw tools list (OpenAI/Anthropic format).
 */
export async function getAgentTools(toolkits: string[]): Promise<unknown[]> {
  try {
    const composio = getComposio();
    const tools = await composio.tools.get(COMPOSIO_USER_ID, { toolkits });
    return Array.isArray(tools) ? tools : [];
  } catch {
    return [];
  }
}

export type { Composio };
