/**
 * lib/llm.ts — Centralized LLM routing via OpenRouter (NO Anthropic, May 2026 stack)
 *
 * Live-priced from openrouter.ai/api/v1/models on 2026-05-25:
 *   bulk   → deepseek/deepseek-v4-flash       $0.10/$0.20 per M  (1M ctx) — bulk classify, scoring
 *   fast   → google/gemini-3.1-flash-lite     $0.25/$1.50 per M  (1M ctx) — ping, parsing
 *   medium → google/gemini-3-flash-preview    $0.50/$3.00 per M  (1M ctx) — short agents
 *   smart  → x-ai/grok-4.20                   $1.25/$2.50 per M  (2M ctx) — Aria, content, email
 *   top    → google/gemini-3.1-pro-preview    $2.00/$12.00 per M (1M ctx) — Marcel, reasoning
 *
 * Override per env: OR_MODEL_BULK / FAST / MEDIUM / SMART / TOP
 * Alternates: openai/gpt-5.5 ($5/$30), openai/gpt-5.4 ($2.50/$15), x-ai/grok-4.20-multi-agent ($2/$6, 2M ctx).
 */

import { createOpenAI } from '@ai-sdk/openai';

export type LLMTier = 'bulk' | 'fast' | 'medium' | 'smart' | 'top';

export const OR_MODELS: Record<LLMTier, string> = {
  bulk:   process.env.OR_MODEL_BULK   ?? 'deepseek/deepseek-v4-flash',
  fast:   process.env.OR_MODEL_FAST   ?? 'google/gemini-3.1-flash-lite',
  medium: process.env.OR_MODEL_MEDIUM ?? 'google/gemini-3-flash-preview',
  smart:  process.env.OR_MODEL_SMART  ?? 'x-ai/grok-4.20',
  top:    process.env.OR_MODEL_TOP    ?? 'google/gemini-3.1-pro-preview',
};

function isOpenRouter(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

type LangfuseClient = { trace: (opts: Record<string, unknown>) => { generation: (opts: Record<string, unknown>) => { end: (opts: Record<string, unknown>) => void } } };
// Lazy Langfuse client (only initialized when keys are present)
let _langfuse: LangfuseClient | null = null;
function getLangfuse(): LangfuseClient | null {
  if (_langfuse) return _langfuse as { trace: (opts: Record<string, unknown>) => { generation: (opts: Record<string, unknown>) => { end: (opts: Record<string, unknown>) => void } } };
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Langfuse } = require('langfuse');
    _langfuse = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com',
    }) as LangfuseClient;
    return _langfuse;
  } catch {
    return null;
  }
}

type TextContent = { type: 'text'; text: string };
type ImageContent = { type: 'image_url'; image_url: { url: string } };
type MessageContent = string | Array<TextContent | ImageContent>;

// Approx prices per million tokens (input/output) — kept in sync with OR_MODELS defaults.
// Used for cost estimation only. Real cost data is on OpenRouter dashboard.
const TIER_PRICES_PER_M: Record<LLMTier, { in: number; out: number }> = {
  bulk:   { in: 0.10, out: 0.20 },
  fast:   { in: 0.25, out: 1.50 },
  medium: { in: 0.50, out: 3.00 },
  smart:  { in: 1.25, out: 2.50 },
  top:    { in: 2.00, out: 12.00 },
};

async function logLLMCall(params: {
  agent: string;
  tier: LLMTier;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  traceId?: string;
  traceName?: string;
  error?: string;
}): Promise<void> {
  try {
    const { query } = await import('@/lib/db');
    const price = TIER_PRICES_PER_M[params.tier];
    const inTok = params.promptTokens ?? 0;
    const outTok = params.completionTokens ?? 0;
    const costUsd = (inTok * price.in + outTok * price.out) / 1_000_000;
    await query(
      `INSERT INTO llm_calls (agent, tier, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, cost_usd, trace_id, trace_name, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [params.agent, params.tier, params.model, inTok, outTok, params.totalTokens ?? (inTok + outTok), params.latencyMs, costUsd.toFixed(6), params.traceId ?? null, params.traceName ?? null, params.error ?? null]
    );
    // Maintain rolling daily total in kv_store so the kill-switch knows when to trip.
    const today = new Date().toISOString().slice(0, 10);
    const usageKey = `llm_daily_usage_${today}`;
    await query(
      `INSERT INTO kv_store (key, value)
       VALUES ($1, jsonb_build_object('spent_usd', $2::numeric, 'updated_at', NOW()::text))
       ON CONFLICT (key) DO UPDATE
         SET value = jsonb_build_object(
           'spent_usd', COALESCE((kv_store.value->>'spent_usd')::numeric, 0) + $2::numeric,
           'updated_at', NOW()::text
         )`,
      [usageKey, costUsd.toFixed(6)]
    );
  } catch { /* never block on cost logging */ }
}

/** Raw LLM call — returns text. Works for all non-streaming cases. */
/**
 * Daily LLM cost cap (kill-switch).
 * Reads cumulative spend for today from kv_store. If >= LLM_DAILY_CAP_USD (default 10),
 * refuses further calls so a runaway loop cannot rack up unbounded spend.
 * Fire-and-forget Telegram alert once per day on cap-hit (deduped via kv_store).
 */
async function assertWithinDailyBudget(): Promise<void> {
  const { query: q } = await import('@/lib/db');
  const today = new Date().toISOString().slice(0, 10);
  const usageKey = `llm_daily_usage_${today}`;
  const rows = (await q('SELECT value FROM kv_store WHERE key = $1', [usageKey])) as Array<{ value: unknown }>;
  const v = rows[0]?.value as { spent_usd?: number } | undefined;
  const spent = typeof v?.spent_usd === 'number' ? v.spent_usd : 0;
  const cap = Number(process.env.LLM_DAILY_CAP_USD ?? '10');
  if (spent >= cap) {
    // Alert once per day to Telegram group, then throw to short-circuit
    try {
      const alertKey = `llm_cap_alerted_${today}`;
      const alertedRows = (await q('SELECT 1 FROM kv_store WHERE key = $1', [alertKey])) as unknown[];
      if (alertedRows.length === 0) {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chat = process.env.TELEGRAM_GROUP_CHAT_ID;
        if (token && chat) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chat,
              text: `🛑 LLM kill-switch: $${spent.toFixed(2)} >= $${cap.toFixed(2)} aujourd'hui. Tous les appels OpenRouter sont bloques jusqu'a demain. Augmente LLM_DAILY_CAP_USD ou investigue.`,
            }),
          }).catch(() => {});
          await q(
            `INSERT INTO kv_store (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING`,
            [alertKey, JSON.stringify({ at: new Date().toISOString(), spent_usd: spent })]
          );
        }
      }
    } catch { /* never block the kill-switch on alert delivery */ }
    throw new Error(`LLM daily cap reached: $${spent.toFixed(2)} >= $${cap.toFixed(2)}`);
  }
}

export async function callLLM({
  system,
  messages,
  maxTokens = 1024,
  tier = 'smart' as LLMTier,
  jsonMode = false,
  traceId,
  traceName,
  agent = 'system',
}: {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: MessageContent }>;
  maxTokens?: number;
  tier?: LLMTier;
  jsonMode?: boolean;
  traceId?: string;
  traceName?: string;
  agent?: string;
}): Promise<string> {
  const startTime = Date.now();
  let result = '';

  await assertWithinDailyBudget();

  if (isOpenRouter()) {
    const model = OR_MODELS[tier];
    const apiMessages: Array<{ role: string; content: MessageContent }> = [];
    if (system) apiMessages.push({ role: 'system', content: system });
    apiMessages.push(...messages);

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://novusepoxy.ca',
        'X-Title': 'Novus Epoxy',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: apiMessages,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.status.toString());
      throw new Error(`OpenRouter error ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    result = (data.choices?.[0]?.message?.content as string) ?? '';
    const latencyMs = Date.now() - startTime;

    // Cost logging (fire-and-forget)
    void logLLMCall({
      agent,
      tier,
      model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens,
      latencyMs,
      traceId,
      traceName,
    });

    // Langfuse tracing (best-effort, never blocks the response)
    try {
      const lf = getLangfuse();
      if (lf) {
        const trace = lf.trace({ id: traceId, name: traceName ?? 'llm-call' });
        trace.generation({
          name: traceName ?? 'callLLM',
          model,
          input: { system, messages },
          output: result,
          usage: { totalTokens: data.usage?.total_tokens },
          metadata: { tier, latencyMs, agent },
        }).end({ output: result });
      }
    } catch { /* never block on observability */ }

    return result;
  }

  // No OPENROUTER_API_KEY configured — surface a hard error so it's not silently lost.
  throw new Error('OPENROUTER_API_KEY missing — set it in Vercel env. No Anthropic fallback.');
}

/** Vercel AI SDK model instance for streamText/generateText (OpenRouter only).
 *
 * Returns `any` to bridge @ai-sdk/openai v3 (LanguageModelV3) with `ai` v4
 * (expects LanguageModelV1). Both interfaces are runtime-compatible — only
 * the TS types diverged. Upgrade `ai` to v5 to drop the cast.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getStreamingModel(tier: LLMTier = 'smart'): any {
  if (!isOpenRouter()) {
    throw new Error('OPENROUTER_API_KEY missing — set it in Vercel env. No Anthropic fallback.');
  }
  const openrouter = createOpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    headers: {
      'HTTP-Referer': 'https://novusepoxy.ca',
      'X-Title': 'Novus Epoxy',
    },
  });
  return openrouter(OR_MODELS[tier]);
}
