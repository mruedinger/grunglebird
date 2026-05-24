import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { jsonError } from '../../../../lib/api-utils';
import {
  type AuthEnv,
  rpInfo,
  readChallenge,
  clearChallengeCookie,
  setSessionCookie,
} from '../../../../lib/auth';

const authEnv = env as AuthEnv;

export const POST: APIRoute = async ({ request }) => {
  let body: AuthenticationResponseJSON;
  try {
    body = (await request.json()) as AuthenticationResponseJSON;
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const expectedChallenge = await readChallenge(request, authEnv, 'auth');
  if (!expectedChallenge) return jsonError(400, 'Challenge expired — try again');

  const row = await authEnv.DB.prepare(
    'SELECT credential_id, public_key, counter, transports FROM credentials WHERE credential_id = ?',
  )
    .bind(body.id)
    .first<{ credential_id: string; public_key: ArrayBuffer; counter: number; transports: string | null }>();

  if (!row) return jsonError(401, 'Unknown credential');

  const { rpID, origin } = rpInfo(request);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: row.credential_id,
        publicKey: new Uint8Array(row.public_key),
        counter: row.counter,
        transports: row.transports
          ? (JSON.parse(row.transports) as AuthenticatorTransportFuture[])
          : undefined,
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Sign-in verification failed' }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'set-cookie': clearChallengeCookie() },
    });
  }

  if (!verification.verified) {
    return new Response(JSON.stringify({ error: 'Sign-in not verified' }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'set-cookie': clearChallengeCookie() },
    });
  }

  await authEnv.DB.prepare('UPDATE credentials SET counter = ? WHERE credential_id = ?')
    .bind(verification.authenticationInfo.newCounter, row.credential_id)
    .run();

  const headers = new Headers({ 'content-type': 'application/json' });
  headers.append('set-cookie', clearChallengeCookie());
  headers.append('set-cookie', await setSessionCookie(authEnv));

  return new Response(JSON.stringify({ ok: true }), { headers });
};
