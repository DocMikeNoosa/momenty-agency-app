// App lock: password (PBKDF2-SHA-256) and passkeys (WebAuthn, Face ID / Touch ID / Windows Hello).
// Passkey assertions are verified locally against the public key saved when the passkey was created.

import { kvGet, kvSet } from './db.js';

const ITERATIONS = 310000;
const enc = new TextEncoder();

export const b64u = {
  enc(buf) {
    const s = String.fromCharCode(...new Uint8Array(buf));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function isSetUp() { return !!kvGet('auth'); }

export function passwordProblem(pw) {
  if (!pw || pw.length < 8) return 'Hasło musi mieć co najmniej 8 znaków.';
  if (!/[0-9]/.test(pw) || !/[^0-9]/.test(pw)) return 'Hasło musi zawierać litery i co najmniej jedną cyfrę.';
  return null;
}

export async function setPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pw, salt, ITERATIONS);
  const prev = kvGet('auth') || {};
  await kvSet('auth', { ...prev, salt: b64u.enc(salt), hash: b64u.enc(hash), iterations: ITERATIONS, fails: 0, lockUntil: 0 });
}

export async function checkPassword(pw) {
  const a = kvGet('auth');
  if (!a) return { ok: false, error: 'Brak skonfigurowanego hasła.' };
  const now = Date.now();
  if (a.lockUntil && a.lockUntil > now) {
    const s = Math.ceil((a.lockUntil - now) / 1000);
    return { ok: false, error: `Zbyt wiele prób. Spróbuj ponownie za ${s} s.` };
  }
  const hash = await derive(pw, b64u.dec(a.salt), a.iterations || ITERATIONS);
  if (equal(hash, b64u.dec(a.hash))) {
    await kvSet('auth', { ...a, fails: 0, lockUntil: 0 });
    return { ok: true };
  }
  const fails = (a.fails || 0) + 1;
  // after 5 failed attempts, wait 30 s, doubling each further attempt (max 15 min)
  const lockUntil = fails >= 5 ? now + Math.min(30000 * 2 ** (fails - 5), 900000) : 0;
  await kvSet('auth', { ...a, fails, lockUntil });
  return { ok: false, error: fails >= 5 ? 'Nieprawidłowe hasło. Dostęp tymczasowo zablokowany.' : 'Nieprawidłowe hasło.' };
}

// ---------- Passkeys ----------

export async function passkeyAvailable() {
  try {
    return !!(window.PublicKeyCredential && window.isSecureContext &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}

export function passkeys() { return (kvGet('auth') || {}).passkeys || []; }

export async function registerPasskey(userName, label) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Momenty Agency' },
      user: { id: userId, name: userName, displayName: userName },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      excludeCredentials: passkeys().map((p) => ({ type: 'public-key', id: b64u.dec(p.id) })),
      attestation: 'none',
      timeout: 60000,
    },
  });
  const resp = cred.response;
  if (typeof resp.getPublicKey !== 'function') throw new Error('Ta przeglądarka nie obsługuje kluczy dostępu w pełni.');
  const spki = resp.getPublicKey();
  const alg = resp.getPublicKeyAlgorithm();
  if (!spki || (alg !== -7 && alg !== -257)) throw new Error('Nieobsługiwany typ klucza dostępu.');
  const a = kvGet('auth') || {};
  const entry = { id: b64u.enc(cred.rawId), pk: b64u.enc(spki), alg, label, createdAt: new Date().toISOString() };
  await kvSet('auth', { ...a, passkeys: [...(a.passkeys || []), entry] });
  return entry;
}

export async function removePasskey(id) {
  const a = kvGet('auth') || {};
  await kvSet('auth', { ...a, passkeys: (a.passkeys || []).filter((p) => p.id !== id) });
}

// DER-encoded ECDSA signature -> raw r||s (64 bytes) as WebCrypto expects.
function derToRaw(der) {
  let i = 2;
  if (der[1] & 0x80) i += der[1] & 0x7f;
  const read = () => {
    if (der[i++] !== 0x02) throw new Error('Zły podpis');
    const len = der[i++];
    let v = der.slice(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = read();
  const s = read();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

export async function unlockWithPasskey() {
  const list = passkeys();
  if (!list.length) throw new Error('Brak zapisanych kluczy dostępu.');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: list.map((p) => ({ type: 'public-key', id: b64u.dec(p.id) })),
      userVerification: 'required',
      timeout: 60000,
    },
  });
  const id = b64u.enc(cred.rawId);
  const entry = list.find((p) => p.id === id);
  if (!entry) throw new Error('Nieznany klucz dostępu.');
  const { authenticatorData, clientDataJSON, signature } = cred.response;

  const client = JSON.parse(new TextDecoder().decode(clientDataJSON));
  if (client.type !== 'webauthn.get') throw new Error('Nieprawidłowa odpowiedź.');
  if (client.challenge !== b64u.enc(challenge)) throw new Error('Nieprawidłowe wyzwanie.');
  if (client.origin !== location.origin) throw new Error('Nieprawidłowe pochodzenie.');

  const ad = new Uint8Array(authenticatorData);
  const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(location.hostname)));
  if (!equal(ad.slice(0, 32), rpHash)) throw new Error('Nieprawidłowa domena klucza.');
  const flags = ad[32];
  if (!(flags & 0x01) || !(flags & 0x04)) throw new Error('Weryfikacja użytkownika nie powiodła się.');

  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
  const signed = new Uint8Array(ad.length + clientHash.length);
  signed.set(ad, 0);
  signed.set(clientHash, ad.length);

  let ok;
  if (entry.alg === -7) {
    const key = await crypto.subtle.importKey('spki', b64u.dec(entry.pk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(new Uint8Array(signature)), signed);
  } else {
    const key = await crypto.subtle.importKey('spki', b64u.dec(entry.pk), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed);
  }
  if (!ok) throw new Error('Podpis klucza dostępu jest nieprawidłowy.');
  return true;
}
