// Minimal browser-side WebAuthn ceremony helpers. Avoids the @simplewebauthn/browser
// dependency by converting the server's options JSON to/from the native credential API.

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type IdJSON = { id: string; type?: string; transports?: string[] };

/** Run a registration ceremony and return the RegistrationResponseJSON for the server. */
export async function register(options: any): Promise<unknown> {
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...options,
    challenge: b64urlToBytes(options.challenge),
    user: { ...options.user, id: b64urlToBytes(options.user.id) },
    excludeCredentials: (options.excludeCredentials ?? []).map((c: IdJSON) => ({
      ...c,
      id: b64urlToBytes(c.id),
    })),
  };

  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Registration was cancelled');
  const res = cred.response as AuthenticatorAttestationResponse;

  return {
    id: cred.id,
    rawId: bytesToB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bytesToB64url(res.clientDataJSON),
      attestationObject: bytesToB64url(res.attestationObject),
      transports:
        typeof res.getTransports === 'function' ? res.getTransports() : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
}

/** Run an authentication ceremony and return the AuthenticationResponseJSON for the server. */
export async function authenticate(options: any): Promise<unknown> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...options,
    challenge: b64urlToBytes(options.challenge),
    allowCredentials: (options.allowCredentials ?? []).map((c: IdJSON) => ({
      ...c,
      id: b64urlToBytes(c.id),
    })),
  };

  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Sign-in was cancelled');
  const res = cred.response as AuthenticatorAssertionResponse;

  return {
    id: cred.id,
    rawId: bytesToB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bytesToB64url(res.clientDataJSON),
      authenticatorData: bytesToB64url(res.authenticatorData),
      signature: bytesToB64url(res.signature),
      userHandle: res.userHandle ? bytesToB64url(res.userHandle) : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
}
