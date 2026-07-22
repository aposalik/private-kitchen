import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { validateRecipe } from "@cooking-game/recipe-schema";
import { AttemptRateLimiter } from "../auth/rate-limit.js";
import { AuthService, AuthenticationError, UsernameTakenError } from "../auth/service.js";
import {
  DEFAULT_SESSION_TTL_MS,
  readSessionToken,
  SessionService,
} from "../auth/session.js";
import { PRODUCTION_SCRYPT_PARAMETERS, type ScryptParameters } from "../auth/password.js";
import { loginSchema, normalizeUsername, registerSchema } from "../auth/validation.js";
import type { PrismaRepository } from "../db/repository.js";

const preferencesSchema = z.strictObject({
  reducedMotion: z.boolean(),
  highContrast: z.boolean(),
  masterVolume: z.number().int().min(0).max(100),
  voiceVolume: z.number().int().min(0).max(100),
});
const recipeBodySchema = z.strictObject({ document: z.unknown() });
const recipeIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9]+$/);

export interface KitchenHttpAppOptions {
  repository: PrismaRepository;
  allowedOrigins?: readonly string[];
  now?: () => Date;
  sessionTtlMs?: number;
  nodeEnv?: string;
  scrypt?: ScryptParameters;
  authRateLimit?: { attempts: number; windowMs: number };
}

export function createKitchenHttpApp(options: KitchenHttpAppOptions) {
  const app = express();
  const now = options.now ?? (() => new Date());
  const sessions = new SessionService(options.repository, {
    now,
    ttlMs: options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    secure: (options.nodeEnv ?? process.env.NODE_ENV) === "production",
  });
  const auth = new AuthService(options.repository, options.scrypt ?? PRODUCTION_SCRYPT_PARAMETERS);
  const rateLimit = options.authRateLimit ?? { attempts: 8, windowMs: 10 * 60_000 };
  const limiter = new AttemptRateLimiter(rateLimit.attempts, rateLimit.windowMs, now);
  const explicitOrigins = new Set(options.allowedOrigins ?? configuredOrigins());

  app.disable("x-powered-by");
  app.use("/api", (request, response, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.get("origin");
      const host = request.get("host");
      const matchesRequestHost = origin !== undefined && host !== undefined
        && (origin === `http://${host}` || origin === `https://${host}`);
      if (!origin || (!explicitOrigins.has(origin) && !matchesRequestHost)) {
        sendError(response, 403, "ORIGIN_REJECTED", "Request origin is not allowed.");
        return;
      }
    }
    next();
  });
  app.use("/api", express.json({ limit: "16kb", strict: true }));

  app.post("/api/auth/register", asyncHandler(async (request, response) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, "INVALID_REQUEST", "Invalid registration details.");
    if (!consumeAuthAttempt(limiter, request, "register", normalizeUsername(parsed.data.username))) {
      return sendError(response, 429, "TOO_MANY_ATTEMPTS", "Too many attempts. Try again later.");
    }
    try {
      const account = await auth.register(parsed.data);
      const session = await sessions.rotate(account.id);
      response.setHeader("set-cookie", sessions.cookie(session.token));
      response.status(201).json({ account: publicAccount(account) });
    } catch (error) {
      if (error instanceof UsernameTakenError) {
        return sendError(response, 409, "USERNAME_UNAVAILABLE", "Username is unavailable.");
      }
      throw error;
    }
  }));

  app.post("/api/auth/login", asyncHandler(async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, "INVALID_REQUEST", "Invalid sign-in details.");
    if (!consumeAuthAttempt(limiter, request, "login", normalizeUsername(parsed.data.username))) {
      return sendError(response, 429, "TOO_MANY_ATTEMPTS", "Too many attempts. Try again later.");
    }
    try {
      const account = await auth.login(parsed.data);
      const session = await sessions.rotate(account.id);
      response.setHeader("set-cookie", sessions.cookie(session.token));
      response.json({ account: publicAccount(account) });
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return sendError(response, 401, "INVALID_CREDENTIALS", "Invalid username or password.");
      }
      throw error;
    }
  }));

  app.post("/api/auth/logout", asyncHandler(async (request, response) => {
    await sessions.revoke(readSessionToken(request.get("cookie")));
    response.setHeader("set-cookie", sessions.clearCookie());
    response.status(204).end();
  }));

  app.get("/api/auth/me", authenticate(sessions), (request, response) => {
    response.json({ account: publicAccount(response.locals.account) });
  });

  app.get("/api/account/preferences", authenticate(sessions), asyncHandler(async (_request, response) => {
    response.json({ preferences: await options.repository.getPreferences(response.locals.account.id) });
  }));

  app.patch("/api/account/preferences", authenticate(sessions), asyncHandler(async (request, response) => {
    const parsed = preferencesSchema.safeParse(request.body);
    if (!parsed.success) return sendError(response, 400, "INVALID_REQUEST", "Invalid preferences.");
    const preferences = await options.repository.updatePreferences(response.locals.account.id, parsed.data);
    response.json({ preferences });
  }));

  app.get("/api/account/history", authenticate(sessions), asyncHandler(async (_request, response) => {
    const rows = await options.repository.listGameHistory(response.locals.account.id);
    response.json({ history: rows.map(({ accountId: _accountId, ...row }) => row) });
  }));

  app.get("/api/account/recipes", authenticate(sessions), asyncHandler(async (_request, response) => {
    response.json({ recipes: await options.repository.listOwnedRecipes(response.locals.account.id) });
  }));

  app.post("/api/account/recipes", authenticate(sessions), asyncHandler(async (request, response) => {
    const document = parseRecipeBody(request.body);
    if (!document) return sendError(response, 400, "INVALID_REQUEST", "Invalid recipe document.");
    const recipe = await options.repository.createOwnedRecipe(response.locals.account.id, document);
    response.status(201).json({ recipe });
  }));

  app.get("/api/account/recipes/:id", authenticate(sessions), asyncHandler(async (request, response) => {
    const id = parseRecipeId(firstParameter(request.params.id));
    if (!id) return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    const recipe = await options.repository.findOwnedRecipe(response.locals.account.id, id);
    if (!recipe) return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    response.json({ recipe });
  }));

  app.patch("/api/account/recipes/:id", authenticate(sessions), asyncHandler(async (request, response) => {
    const id = parseRecipeId(firstParameter(request.params.id));
    const document = parseRecipeBody(request.body);
    if (!id) return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    if (!document) return sendError(response, 400, "INVALID_REQUEST", "Invalid recipe document.");
    const recipe = await options.repository.updateOwnedRecipe(response.locals.account.id, id, document);
    if (!recipe) return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    response.json({ recipe });
  }));

  app.delete("/api/account/recipes/:id", authenticate(sessions), asyncHandler(async (request, response) => {
    const id = parseRecipeId(firstParameter(request.params.id));
    if (!id || !await options.repository.deleteOwnedRecipe(response.locals.account.id, id)) {
      return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    }
    response.status(204).end();
  }));

  app.use("/api", (_request, response) => sendError(response, 404, "NOT_FOUND", "Endpoint not found."));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number(error.status)
      : 500;
    if (status === 413) return sendError(response, 413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
    if (status === 400 || error instanceof SyntaxError) {
      return sendError(response, 400, "INVALID_JSON", "Malformed JSON body.");
    }
    sendError(response, 500, "INTERNAL_ERROR", "Request could not be completed.");
  });

  return app;
}

function authenticate(sessions: SessionService) {
  return asyncHandler(async (request, response, next) => {
    const token = readSessionToken(request.get("cookie"));
    const session = await sessions.resolveToken(token);
    if (!session) {
      if (token) response.setHeader("set-cookie", sessions.clearCookie());
      return sendError(response, 401, "AUTHENTICATION_REQUIRED", "Sign in required.");
    }
    response.locals.account = session.account;
    next();
  });
}

function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => unknown | Promise<unknown>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function consumeAuthAttempt(
  limiter: AttemptRateLimiter,
  request: Request,
  namespace: string,
  normalizedUsername: string,
): boolean {
  const ip = request.ip || request.socket.remoteAddress || "unknown";
  return limiter.consume([`${namespace}:ip:${ip}`, `${namespace}:username:${normalizedUsername}`]);
}

function parseRecipeBody(body: unknown) {
  const envelope = recipeBodySchema.safeParse(body);
  if (!envelope.success) return null;
  const recipe = validateRecipe(envelope.data.document);
  return recipe.success ? recipe.data : null;
}

function parseRecipeId(id: string | undefined): string | null {
  const parsed = recipeIdSchema.safeParse(id);
  return parsed.success ? parsed.data : null;
}

function firstParameter(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function publicAccount(account: { username: string; displayName: string }) {
  return { username: account.username, displayName: account.displayName };
}

function configuredOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function sendError(response: Response, status: number, code: string, message: string) {
  return response.status(status).json({ error: { code, message } });
}
