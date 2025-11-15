// src/server/context.ts
import * as dbService from "../services/db";
import { logger } from "../utils/log";
import { getCookie } from "../utils/cookie";

export type AuthUser = {
  id: number;
  email: string;
  name: string | null;
};

export type Context = {
  req: Request;
  res: Response;
  user?: AuthUser;
};

export async function createContext({
  req,
  res,
}: {
  req: Request;
  res: Response;
}): Promise<Context> {
  try {
    const sessionToken = getCookie(req, "session_token")?.split(".")[0];
    if (!sessionToken) {
      return { req, res };
    }

    const session = await dbService.getSessionByToken(sessionToken);
    if (!session.ok) {
      return { req, res };
    }

    if (new Date() > session.value.expiresAt) {
      return { req, res };
    }

    const dbUser = await dbService.getUser(session.value.userId);
    if (!dbUser.ok) {
      return { req, res };
    }

    return {
      req,
      res,
      user: {
        id: dbUser.value.id,
        email: dbUser.value.email,
        name: dbUser.value.name,
      },
    };
  } catch (error) {
    logger.child({ service: "trpc" }).error(error, "Auth context error");
    return { req, res };
  }
}
