/**
 * lib/llm.ts — Centralized LLM routing via OpenRouter + Langfuse observability
 *
 * Tiers:
 *   bulk   → deepseek/deepseek-v3   ($0.14/$0.28 per M) — lead scoring, bulk classification, summaries
 *   fast   → google/gemini-flash-1.5-8b ($0.04/$0.15 per M) — parsing, ping, simple tasks
 *   medium → google/gemini-flash-1.5    ($0.075/$0.30 per M) — short agents, analysis
 *   smart  → anthropic/claude-sonnet-4-5 ($3/$15 per M)    — agents, email, content
 *   top    → anthropic/claude-opus-4    ($15/$75 per M)    — Marcel, critical decisions
 */

import { createOpenAI } from '@ai-sdk/openai';

export type LLMTier = 'bulk' | 'fast' | 'medium' | 'smart' | 'top';

export const OR_MODELS: Record<LLMTier, string> = {
  bulk:   'deepseek/deepseek-v3',
  fast:   'google/gemini-flash-1.5-8b',
  medium: 'google/gemini-flash-1.5',
  smart:  'anthropic/claude-sonnet-4-5',
  top:    'anthropic/claude-opus-4',
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

  // Fallback: Anthropic direct API
  const modelMap: Record<LLMTier, string> = {
    bulk:   'claude-haiku-4-5-20251001',
    fast:   'claude-haiku-4-5-20251001',
    medium: 'claude-haiku-4-5-20251001',
    smart:  'claude-sonnet-4-6',
    top:    'claude-opus-4-6',
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelMap[tier],
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages,
    }),
  });

  if (!res.ok) throw new Error(`Anthropic error ${res.status}`);
  const data = await res.json();
  return (data.content?.[0]?.text as string) ?? '';
}

/** Vercel AI SDK model instance for streamText/generateText */
export function getStreamingModel(tier: LLMTier = 'smart') {
  if (isOpenRouter()) {
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

  // Fallback: use @ai-sdk/anthropic
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { anthropic } = require('@ai-sdk/anthropic');
  const modelMap: Record<LLMTier, string> = {
    bulk:   'claude-haiku-4-5-20251001',
    fast:   'claude-haiku-4-5-20251001',
    medium: 'claude-haiku-4-5-20251001',
    smart:  'claude-sonnet-4-6',
    top:    'claude-opus-4-6',
  };
  return anthropic(modelMap[tier]);
}
