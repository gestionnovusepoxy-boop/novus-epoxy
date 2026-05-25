import { Composio } from '@composio/core';

export const COMPOSIO_USER_ID = 'novusepoxy-admin';

let _client: Composio | null = null;

export function getComposio(): Composio {
  if (!_client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) throw new Error('COMPOSIO_API_KEY manquant');
    _client = new Composio({
      apiKey,
      toolkitVersions: {
        gmail: '20251027_00',
        googlecalendar: '20251027_00',
        googlesheets: '20251027_00',
      },
    });
  }
  return _client;
}

/**
 * Execute a Composio action directly.
 * Returns { ok, data, error }
 */
export async function runAction(
  action: string,
  args: Record<string, unknown>,
  connectedAccountId?: string,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const composio = getComposio();
    const result = await composio.tools.execute(action, {
      userId: COMPOSIO_USER_ID,
      ...(connectedAccountId ? { connectedAccountId } : {}),
      arguments: args,
    });
    if (result.successful) return { ok: true, data: result.data };
    return { ok: false, error: String(result.error ?? 'Action failed') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Get Composio tools list for AI agent use.
 * Returns OpenAI-compatible tools array.
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
