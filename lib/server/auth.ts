import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
export const SESSION_COOKIE = IS_PRODUCTION ? "__Host-kladovaya_session" : "kladovaya_session";
const SESSION_ISSUER = "kladovaya";
const SESSION_AUDIENCE = "kladovaya-admin";

export interface SessionUser {
  email: string;
  name: string;
  role: "Admin" | "Manager" | "Accountant";
}

function sessionKey() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(value);
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(sessionKey());
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: IS_PRODUCTION,
    path: "/",
    maxAge: 60 * 60 * 8
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  if (SESSION_COOKIE !== "kladovaya_session") jar.delete("kladovaya_session");
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { issuer: SESSION_ISSUER, audience: SESSION_AUDIENCE, algorithms: ["HS256"] });
    if (typeof payload.email !== "string" || typeof payload.name !== "string" || typeof payload.role !== "string") return null;
    if (!(["Admin", "Manager", "Accountant"] as const).includes(payload.role as SessionUser["role"])) return null;
    return { email: payload.email, name: payload.name, role: payload.role as SessionUser["role"] };
  } catch {
    return null;
  }
}
