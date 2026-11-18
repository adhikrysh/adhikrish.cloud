// Who is calling? Cloudflare Access answers that before the request reaches us: it signs a JWT
// (Cf-Access-Jwt-Assertion header) for every request it lets through, you after login or dots with
// its service token. We verify that signature, so a device on the LAN that reaches the container
// directly, skipping Access, gets nothing.
import { createRemoteJWKSet, jwtVerify } from "jose";

export type Auth = { team: string; aud: string; certsUrl?: string };
export type Caller = { who: string };

export function verifier(auth: Auth) {
  const jwks = createRemoteJWKSet(new URL(auth.certsUrl ?? `https://${auth.team}.cloudflareaccess.com/cdn-cgi/access/certs`));
  return async function caller(request: Request): Promise<Caller | null> {
    const token = request.headers.get("cf-access-jwt-assertion");
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: `https://${auth.team}.cloudflareaccess.com`, audience: auth.aud });
      // People carry an email; service tokens carry common_name (the token's client id).
      const who = typeof payload.email === "string" ? payload.email : `service:${String(payload.common_name ?? "unknown")}`;
      return { who };
    } catch {
      return null;
    }
  };
}
