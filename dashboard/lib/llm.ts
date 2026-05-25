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

/** Raw LLM call — returns text. Works for all non-streaming cases. */
export async function callLLM({
  system,
  messages,
  maxTokens = 1024,
  tier = 'smart' as LLMTier,
  jsonMode = false,
  traceId,
  traceName,
}: {
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: MessageContent }>;
  maxTokens?: number;
  tier?: LLMTier;
  jsonMode?: boolean;
  traceId?: string;
  traceName?: string;
}): Promise<string> {
  const startTime = Date.now();
  let result = '';

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
          metadata: { tier, latencyMs: Date.now() - startTime },
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
