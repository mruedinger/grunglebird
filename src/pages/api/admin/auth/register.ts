import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { jsonError } from '../../../../lib/api-utils';
import {
  type AuthEnv,
  requireRegistrationAuth,
  rpInfo,
  readChallenge,
  clearChallengeCookie,
  setSessionCookie,
  generateRecoveryIfMissing,
  getSession,
} from '../../../../lib/auth';

const authEnv = env as AuthEnv;

export const POST: APIRoute = async ({ request, url }) => {
  const token = url.searchParams.get('token');
  const denied = await requireRegistrationAuth(request, authEnv, token);
  if (denied) return denied;

  // Was this a bootstrap (no prior session)? If so we auto-mint a session below.
  const hadSession = await getSession(request, authEnv);

  let body: RegistrationResponseJSON;
  try {
    body = (await request.json()) as RegistrationResponseJSON;
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const expectedChallenge = await readChallenge(request, authEnv, 'reg');
  if (!expectedChallenge) return jsonError(400, 'Challenge expired — try again');

  const { rpID, origin } = rpInfo(request);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Registration verification failed' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'set-cookie': clearChallengeCookie() },
    });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return new Response(JSON.stringify({ error: 'Registration not verified' }), {
      status: 400,
      headers: { 'content-type': 'application/json', 'set-cookie': clearChallengeCookie() },
    });
  }

  const { credential } = verification.registrationInfo;
  await authEnv.DB.prepare(
    `INSERT INTO credentials (credential_id, public_key, counter, transports, label, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      credential.id,
      credential.publicKey,
      credential.counter,
      credential.transports ? JSON.stringify(credential.transports) : null,
      typeof body.id === 'string' ? body.id.slice(0, 12) : null,
      Math.floor(Date.now() / 1000),
    )
    .run();

  const recoveryCode = await generateRecoveryIfMissing(authEnv);

  const cookies = [clearChallengeCookie()];
  if (!hadSession) cookies.push(await setSessionCookie(authEnv));

  const headers = new Headers({ 'content-type': 'application/json' });
  for (const c of cookies) headers.append('set-cookie', c);

  return new Response(JSON.stringify({ ok: true, recoveryCode: recoveryCode ?? undefined }), {
    headers,
  });
};
