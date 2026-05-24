import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { jsonError } from '../../../../lib/api-utils';
import {
  type AuthEnv,
  requireRegistrationAuth,
  rpInfo,
  setChallengeCookie,
} from '../../../../lib/auth';

const authEnv = env as AuthEnv;

export const GET: APIRoute = async ({ request, url }) => {
  const mode = url.searchParams.get('mode');
  const { rpID } = rpInfo(request);

  if (mode === 'register') {
    const denied = await requireRegistrationAuth(request, authEnv, url.searchParams.get('token'));
    if (denied) return denied;

    const { results } = await authEnv.DB.prepare(
      'SELECT credential_id, transports FROM credentials',
    ).all<{ credential_id: string; transports: string | null }>();

    const options = await generateRegistrationOptions({
      rpName: 'Grunglebird',
      rpID,
      userName: 'admin',
      userID: new TextEncoder().encode('grunglebird-admin'),
      attestationType: 'none',
      excludeCredentials: results.map((c) => ({
        id: c.credential_id,
        transports: c.transports
          ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[])
          : undefined,
      })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });

    return new Response(JSON.stringify(options), {
      headers: { 'content-type': 'application/json', 'set-cookie': await setChallengeCookie(authEnv, 'reg', options.challenge) },
    });
  }

  if (mode === 'auth') {
    const { results } = await authEnv.DB.prepare(
      'SELECT credential_id, transports FROM credentials',
    ).all<{ credential_id: string; transports: string | null }>();

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      allowCredentials: results.map((c) => ({
        id: c.credential_id,
        transports: c.transports
          ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[])
          : undefined,
      })),
    });

    return new Response(JSON.stringify(options), {
      headers: { 'content-type': 'application/json', 'set-cookie': await setChallengeCookie(authEnv, 'auth', options.challenge) },
    });
  }

  return jsonError(400, 'mode must be "register" or "auth"');
};
