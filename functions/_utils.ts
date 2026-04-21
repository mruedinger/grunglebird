export interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY?: string;
  DEV?: string;
}

export function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function parseEditCookie(request: Request): { id: number; token: string } | null {
  const header = request.headers.get('cookie') ?? '';
  const match = /(?:^|;\s*)pledge=(\d+):([^;]+)/.exec(header);
  if (!match) return null;
  return { id: Number(match[1]), token: match[2] };
}

export function setEditCookie(id: number, token: string): string {
  const maxAge = 60 * 60 * 24 * 90; // 90 days
  return `pledge=${id}:${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearEditCookie(): string {
  return 'pledge=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

export type ValidPledge = {
  name: string;
  amount_cents: number;
  venmo_handle: string;
  is_private: boolean;
};

export function validatePledge(body: unknown): ValidPledge | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = String(b.name ?? '').trim();
  const venmo = String(b.venmo_handle ?? '').trim().replace(/^@/, '');
  const amount = Number(b.amount);
  const is_private = Boolean(b.is_private);

  if (!name || name.length > 50) return { error: 'Name is required (max 50 characters).' };
  if (!Number.isFinite(amount) || amount < 1 || amount > 10000) {
    return { error: 'Amount must be between $1 and $10,000.' };
  }
  if (!venmo || venmo.length > 50 || !/^[A-Za-z0-9_-]+$/.test(venmo)) {
    return { error: 'Venmo handle is required (letters, numbers, hyphens, underscores).' };
  }
  return { name, amount_cents: Math.round(amount * 100), venmo_handle: venmo, is_private };
}

export async function verifyTurnstile(
  secret: string,
  token: unknown,
  ip: string | null,
): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  const data = (await res.json()) as { success: boolean };
  return data.success === true;
}

export function requireAccess(request: Request, env: Env): Response | null {
  if (env.DEV === '1') return null;
  const jwt = request.headers.get('cf-access-jwt-assertion');
  if (!jwt) return jsonError(401, 'Cloudflare Access required');
  return null;
}
