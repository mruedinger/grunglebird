import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { jsonError } from './api-utils';

// Secrets aren't part of the generated Cloudflare.Env, so augment it here.
export type AuthEnv = Cloudflare.Env & {
  SESSION_SECRET: string;
  SETUP_TOKEN?: string;
};

const SESSION_COOKIE = 'admin_session';
const CHALLENGE_COOKIE = 'admin_challenge';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const CHALLENGE_TTL = 60 * 5; // 5 minutes
const RECOVERY_KEY = 'recovery_code_hash';

export type CredentialRow = {
  credential_id: string;
  public_key: ArrayBuffer;
  counter: number;
  transports: string | null;
};

export type ChallengePurpose = 'reg' | 'auth';

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? '';
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(header);
  return match ? match[1] : null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmac(secret: string, message: string): Promise<string> {
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return isoBase64URL.fromBuffer(new Uint8Array(sig));
}

async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Modern browsers treat http://localhost as a secure context, so `Secure` is fine in dev too.
function sessionCookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export async function setSessionCookie(env: AuthEnv): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const sig = await hmac(env.SESSION_SECRET, String(exp));
  return sessionCookie(`${exp}.${sig}`, SESSION_TTL);
}

export function clearSessionCookie(): string {
  return sessionCookie('', 0);
}

async function hasValidSession(request: Request, env: AuthEnv): Promise<boolean> {
  if (!env.SESSION_SECRET) return false; // fail closed if misconfigured
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot < 0) return false;
  const expStr = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmac(env.SESSION_SECRET, expStr);
  return timingSafeEqual(sig, expected);
}

/** API guard for admin routes. Returns a 401 Response when not authorized, else null. */
export async function requireAdmin(request: Request, env: AuthEnv): Promise<Response | null> {
  if (import.meta.env.DEV) return null;
  if (await hasValidSession(request, env)) return null;
  return jsonError(401, 'Admin sign-in required');
}

/** For Astro pages to branch their render. Honors the same dev bypass as requireAdmin. */
export async function getSession(request: Request, env: AuthEnv): Promise<boolean> {
  if (import.meta.env.DEV) return true;
  return hasValidSession(request, env);
}

async function credentialCount(env: AuthEnv): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM credentials').first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * The only authorization for registering a credential:
 *   - bootstrap: credentials table empty AND a valid SETUP_TOKEN is presented;
 *   - otherwise: a valid admin session (token is inert once bootstrapped).
 * Returns null when authorized, else an error Response.
 */
export async function requireRegistrationAuth(
  request: Request,
  env: AuthEnv,
  token: string | null,
): Promise<Response | null> {
  if (await credentialCount(env) === 0) {
    if (env.SETUP_TOKEN && token && timingSafeEqual(token, env.SETUP_TOKEN)) return null;
    return jsonError(403, 'Setup token required');
  }
  if (await hasValidSession(request, env)) return null;
  return jsonError(401, 'Admin sign-in required');
}

// --- WebAuthn relying-party info, derived from the request so prod + localhost both work ---
export function rpInfo(request: Request): { rpID: string; origin: string } {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}

// --- Challenge cookie (signed, short-lived, single-purpose) ---
export async function setChallengeCookie(
  env: AuthEnv,
  purpose: ChallengePurpose,
  challenge: string,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + CHALLENGE_TTL;
  const payload = `${purpose}.${challenge}.${exp}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${CHALLENGE_COOKIE}=${payload}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${CHALLENGE_TTL}`;
}

export function clearChallengeCookie(): string {
  return `${CHALLENGE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function readChallenge(
  request: Request,
  env: AuthEnv,
  purpose: ChallengePurpose,
): Promise<string | null> {
  if (!env.SESSION_SECRET) return null; // fail closed if misconfigured
  const raw = readCookie(request, CHALLENGE_COOKIE);
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [p, challenge, expStr, sig] = parts;
  if (p !== purpose) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const expected = await hmac(env.SESSION_SECRET, `${p}.${challenge}.${expStr}`);
  if (!timingSafeEqual(sig, expected)) return null;
  return challenge;
}

// --- Recovery code: at most one hash stored; one-time and self-rearming ---
function randomRecoveryCode(): string {
  return isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(24)));
}

/** Generate + store a recovery code only when none exists. Returns the plaintext, or null. */
export async function generateRecoveryIfMissing(env: AuthEnv): Promise<string | null> {
  const existing = await env.DB.prepare('SELECT 1 FROM auth_meta WHERE key = ?')
    .bind(RECOVERY_KEY)
    .first();
  if (existing) return null;
  const code = randomRecoveryCode();
  await env.DB.prepare('INSERT INTO auth_meta (key, value) VALUES (?, ?)')
    .bind(RECOVERY_KEY, await sha256Hex(code))
    .run();
  return code;
}

/** Consume a recovery code: delete the hash on a correct match. Returns true on success. */
export async function consumeRecovery(env: AuthEnv, code: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT value FROM auth_meta WHERE key = ?')
    .bind(RECOVERY_KEY)
    .first<{ value: string }>();
  if (!row) return false;
  if (!timingSafeEqual(await sha256Hex(code), row.value)) return false;
  await env.DB.prepare('DELETE FROM auth_meta WHERE key = ?').bind(RECOVERY_KEY).run();
  return true;
}
