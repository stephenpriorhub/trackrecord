/**
 * Google API access as the shared OxfordHub service account
 * (GOOGLE_SERVICE_ACCOUNT_JSON, GCP project primeval-rain-501214-e3).
 *
 * Signs its own RS256 JWT with node:crypto — no googleapis dependency — the
 * same way promo-analyzer does.
 *
 * Scopes: Drive read (export a sheet as xlsx) and Sheets read/write (append a
 * logged trade). Writing needs the sheet shared with the account as EDITOR.
 */
import crypto from "node:crypto";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
].join(" ");

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    // Env vars often escape the PEM's newlines.
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    return sa;
  } catch {
    return null;
  }
}

export function serviceAccountEmail(): string | null {
  return loadServiceAccount()?.client_email ?? null;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let tokenCache: { token: string; exp: number } | null = null;

/** An access token, or null when no service account is configured. Throws on a failed exchange. */
export async function googleAccessToken(): Promise<string | null> {
  const sa = loadServiceAccount();
  if (!sa) return null;
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPES,
      aud: sa.token_uri || TOKEN_URI,
      iat: now,
      exp: now + 3600,
    }),
  );
  const input = `${header}.${claim}`;
  const signature = base64url(crypto.sign("RSA-SHA256", Buffer.from(input), sa.private_key));

  const res = await fetch(sa.token_uri || TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${input}.${signature}`,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Google token exchange returned no token");
  tokenCache = { token: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return json.access_token;
}
