export type Env = Cloudflare.Env;

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
  const is_private = b.is_private !== false;

  if (!name || name.length > 50) return { error: 'Name is required (max 50 characters).' };
  if (!Number.isFinite(amount) || amount < 1 || amount > 10000) {
    return { error: 'Amount must be between $1 and $10,000.' };
  }
  if (!venmo || venmo.length > 50 || !/^[A-Za-z0-9_-]+$/.test(venmo)) {
    return { error: 'Venmo handle is required (letters, numbers, hyphens, underscores).' };
  }
  return { name, amount_cents: Math.round(amount * 100), venmo_handle: venmo, is_private };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function enforceRateLimit(
  request: Request,
  env: Env,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<Response | null> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const bucketKey = await sha256Hex(`${action}:${ip}:${windowStart}`);

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket_key, action, window_start, count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(bucketKey, action, windowStart)
    .first<{ count: number }>();

  await env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < ?`)
    .bind(now - windowSeconds * 24)
    .run();

  if ((row?.count ?? limit + 1) > limit) {
    return jsonError(429, 'Too many attempts. Try again later.');
  }

  return null;
}

export function requireAccess(request: Request, _env: Env): Response | null {
  if (import.meta.env.DEV) return null;
  const jwt = request.headers.get('cf-access-jwt-assertion');
  if (!jwt) return jsonError(401, 'Cloudflare Access required');
  return null;
}
