import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { dbService } from "../services/db.js";
import { logger } from "../utils/log.js";
import { publicProcedure } from "../trpc/trpc.js";

const log = logger.child({ service: "auth-middleware" });

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
}

// Auth middleware for regular routes
export const authMiddleware = createMiddleware<{
  Variables: {
    user: AuthUser;
  };
}>(async (c, next) => {
  // Get session token from cookie (better-auth uses 'session' cookie by default)
  const sessionToken = getCookie(c, "session_token")?.split(".")[0];
  if (!sessionToken) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    // Verify session with better-auth session table
    const session = await dbService.getSessionByToken(sessionToken);
    if (!session.ok) {
      return c.json({ error: "Invalid session" }, 401);
    }

    // Check if session is expired
    if (new Date() > session.value.expiresAt) {
      return c.json({ error: "Session expired" }, 401);
    }

    // Get user info
    const user = await dbService.getUser(session.value.userId);
    if (!user.ok) {
      return c.json({ error: "User not found" }, 401);
    }

    // Set user in context
    c.set("user", {
      id: user.value.id,
      email: user.value.email,
      name: user.value.name,
    });

    await next();
  } catch (error) {
    log.error(error, "Auth middleware error");
    return c.json({ error: "Authentication failed" }, 500);
  }
});

// Helper function to authenticate WebSocket connections
export async function authenticateWebSocket(
  sessionToken: string
): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  if (!sessionToken) {
    return { ok: false, error: "No session token provided" };
  }

  try {
    // Verify session
    const session = await dbService.getSessionByToken(sessionToken);
    if (!session.ok) {
      return { ok: false, error: "Invalid session" };
    }

    // Check if session is expired
    if (new Date() > session.value.expiresAt) {
      return { ok: false, error: "Session expired" };
    }

    // Get user info
    const user = await dbService.getUser(session.value.userId);
    if (!user.ok) {
      return { ok: false, error: "User not found" };
    }

    return {
      ok: true,
      user: {
        id: user.value.id,
        email: user.value.email,
        name: user.value.name,
      },
    };
  } catch (error) {
    log.error(error, "WebSocket auth error");
    return { ok: false, error: "Authentication failed" };
  }
}
