import { timingSafeEqual } from "node:crypto";

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

type LoginAttempt = { failures: number; resetAt: number };
const globalSecurity = globalThis as typeof globalThis & { __kladovayaLoginAttempts?: Map<string, LoginAttempt> };
const loginAttempts = globalSecurity.__kladovayaLoginAttempts ??= new Map<string, LoginAttempt>();

export function clientIp(request: Request) {
  return request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

export function loginRateLimit(request: Request) {
  const key = clientIp(request);
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.delete(key);
    return { allowed: true, retryAfter: 0, key };
  }
  return {
    allowed: attempt.failures < MAX_LOGIN_ATTEMPTS,
    retryAfter: Math.max(1, Math.ceil((attempt.resetAt - now) / 1000)),
    key
  };
}

export function recordLoginFailure(key: string) {
  const now = Date.now();
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(key, { failures: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  attempt.failures += 1;
}

export function clearLoginFailures(key: string) {
  loginAttempts.delete(key);
}

export function hasTrustedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  const expected = process.env.APP_ORIGIN || (forwardedHost ? `${forwardedProto}://${forwardedHost}` : new URL(request.url).origin);
  try {
    return new URL(origin).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

export async function readBoundedJson<T>(request: Request, maxBytes: number): Promise<T | null> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isValidEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
