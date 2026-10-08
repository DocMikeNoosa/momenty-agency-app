// AI helpers. All requests go through the agency's own server function (the API key never reaches the phone).

import * as cloud from './cloud.js';

export const available = () => cloud.isLinked();

export class AIError extends Error {}

export async function ask({ system, messages, tools, json_schema, max_tokens = 8000, effort = 'medium' }) {
  if (!available()) throw new AIError('Asystent AI działa po połączeniu z serwerem agencji (Ustawienia → Zespół i synchronizacja).');
  const res = await cloud.fn('ai', '', { system, messages, tools, json_schema, max_tokens, effort });
  if (res.stop_reason === 'refusal') throw new AIError('AI odmówiło wykonania tego polecenia. Spróbuj sformułować je inaczej.');
  return res;
}

export function textOf(res) {
  return (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

/** Asks for a JSON answer that follows `schema` (structured output). */
export async function askJSON({ system, prompt, schema, max_tokens = 8000, effort = 'medium' }) {
  const res = await ask({ system, messages: [{ role: 'user', content: prompt }], json_schema: schema, max_tokens, effort });
  const text = textOf(res);
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new AIError(res.stop_reason === 'max_tokens' ? 'Odpowiedź AI była zbyt długa – spróbuj ponownie.' : 'AI zwróciło nieczytelną odpowiedź – spróbuj ponownie.');
  }
}

// ---------- voice input ----------
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** Browser speech recognition works in desktop Chrome/Edge/Safari and Safari on iPhone (not in Home Screen apps). */
export const canDictate = () => !!SR && !(standalone() && /iPhone|iPad/.test(navigator.userAgent));

export function dictate({ onText, onEnd }) {
  const r = new SR();
  r.lang = 'pl-PL';
  r.interimResults = true;
  r.continuous = false;
  let final = '';
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
    }
    onText(final + interim);
  };
  r.onend = () => onEnd?.(final);
  r.onerror = () => onEnd?.(final);
  r.start();
  return () => r.stop();
}

// ---------- small utilities ----------
export function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  // final avalanche so similar inputs spread evenly (FNV alone keeps low bits correlated)
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
