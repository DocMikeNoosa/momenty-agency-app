// AI proxy: the app sends a Messages API request; this function adds the secret API key,
// checks that the caller belongs to the agency and applies a daily limit.
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { db, handle, HttpError, json, requireMember } from '../_shared/util.ts';

const MODEL = () => Deno.env.get('AI_MODEL') || 'claude-opus-5-5';
const DAILY_LIMIT = () => Number(Deno.env.get('AI_DAILY_LIMIT') || 400);

async function countCall(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db(`ai_usage?user_id=eq.${userId}&day=eq.${today}&select=calls`);
  const calls = rows?.[0]?.calls || 0;
  if (calls >= DAILY_LIMIT()) throw new HttpError(429, 'Dzienny limit zapytań AI został wykorzystany.');
  await db('ai_usage?on_conflict=user_id,day', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, day: today, calls: calls + 1 }),
  });
}

export const handler = handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Nieobsługiwana metoda');
  const member = await requireMember(req);
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new HttpError(503, 'AI nie jest skonfigurowane (brak ANTHROPIC_API_KEY na serwerze).');
  const body = await req.json();
  if (!Array.isArray(body.messages) || !body.messages.length) throw new HttpError(400, 'Brak wiadomości');
  await countCall(member.user_id);

  const client = new Anthropic({ apiKey, baseURL: Deno.env.get('ANTHROPIC_BASE_URL') || undefined, maxRetries: 2 });
  const effort = ['low', 'medium', 'high'].includes(body.effort) ? body.effort : 'medium';
  try {
    const response = await client.beta.messages.create({
      model: MODEL(),
      max_tokens: Math.min(Number(body.max_tokens) || 8000, 16000),
      thinking: { type: 'adaptive' },
      output_config: body.json_schema && typeof body.json_schema === 'object'
        ? { effort, format: { type: 'json_schema', schema: body.json_schema } }
        : { effort },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: typeof body.system === 'string' ? body.system : undefined,
      messages: body.messages,
      tools: Array.isArray(body.tools) && body.tools.length ? body.tools : undefined,
    });
    return json({
      content: response.content,
      stop_reason: response.stop_reason,
      stop_details: response.stop_details ?? null,
      model: response.model,
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'AI jest chwilowo przeciążone – spróbuj za minutę.');
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'Nieprawidłowy klucz API AI na serwerze.');
    if (e instanceof Anthropic.BadRequestError) { console.error('AI 400:', e.message); throw new HttpError(400, 'AI odrzuciło zapytanie (np. za długie). Spróbuj krócej lub inaczej.'); }
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `Błąd AI (${e.status}).`);
    throw e;
  }
});
