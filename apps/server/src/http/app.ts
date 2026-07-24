import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { diagnoseRecipe, validateRecipe } from "@cooking-game/recipe-schema";
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
const recipeLicenseSchema = z.strictObject({ license: z.enum(["CC0_1_0", "CC_BY_4_0"]) });
const reportSchema = z.strictObject({
  reason: z.enum(["HATE_OR_HARASSMENT", "SEXUAL_CONTENT", "VIOLENCE", "SPAM", "COPYRIGHT", "OTHER"]),
  details: z.string().trim().min(10).max(500),
});
const moderationReasonSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });
const emptyBodySchema = z.strictObject({});

export interface KitchenHttpAppOptions {
  repository: PrismaRepository;
  allowedOrigins?: readonly string[];
  now?: () => Date;
  sessionTtlMs?: number;
  nodeEnv?: string;
  scrypt?: ScryptParameters;
  authRateLimit?: { attempts: number; windowMs: number };
  moderatorUsernames?: readonly string[];
  recipeRateLimits?: Partial<Record<"mutation" | "publish" | "testSession" | "report" | "discovery", {
    attempts: number;
    windowMs: number;
  }>>;
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
  const recipeLimiters = Object.fromEntries(
    Object.entries({
      mutation: { attempts: 60, windowMs: 60_000 },
      publish: { attempts: 10, windowMs: 60_000 },
      testSession: { attempts: 10, windowMs: 60_000 },
      report: { attempts: 5, windowMs: 60_000 },
      discovery: { attempts: 120, windowMs: 60_000 },
      ...options.recipeRateLimits,
    }).map(([name, config]) => [
      name,
      new AttemptRateLimiter(config.attempts, config.windowMs, now),
    ]),
  ) as Record<"mutation" | "publish" | "testSession" | "report" | "discovery", AttemptRateLimiter>;
  const moderatorUsernames = new Set(
    options.moderatorUsernames ?? configuredModeratorUsernames(),
  );
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

  app.get("/api/auth/session", asyncHandler(async (request, response) => {
    const token = readSessionToken(request.get("cookie"));
    const session = await sessions.resolveToken(token);
    if (!session) {
      if (token) response.setHeader("set-cookie", sessions.clearCookie());
      return response.json({ account: null });
    }
    response.json({ account: publicAccount(session.account) });
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
    if (!consumeRecipeAttempt(recipeLimiters.mutation, request, response.locals.account.id, "recipe-mutation")) {
      return sendRateLimit(response);
    }
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
    if (!consumeRecipeAttempt(recipeLimiters.mutation, request, response.locals.account.id, "recipe-mutation")) {
      return sendRateLimit(response);
    }
    const existing = await options.repository.findOwnedRecipe(response.locals.account.id, id);
    if (existing && existing.status !== "DRAFT") {
      return sendError(response, 409, "RECIPE_NOT_EDITABLE", "Unpublish the recipe before editing.");
    }
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

  app.post("/api/account/recipes/:id/validate", authenticate(sessions), asyncHandler(async (request, response) => {
    const id = parseRecipeId(firstParameter(request.params.id));
    if (!id || !emptyBodySchema.safeParse(request.body).success) {
      return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    }
    const recipe = await options.repository.findOwnedRecipe(response.locals.account.id, id);
    if (!recipe) return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    response.json({ diagnostics: diagnoseRecipe(recipe.document) });
  }));

  app.post("/api/account/recipes/:id/publish", authenticate(sessions), asyncHandler(async (request, response) => {
    const id = parseRecipeId(firstParameter(request.params.id));
    const body = recipeLicenseSchema.safeParse(request.body);
    if (!id) return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    if (!body.success) return sendError(response, 400, "LICENSE_REQUIRED", "Choose a supported license.");
    if (!consumeRecipeAttempt(recipeLimiters.publish, request, response.locals.account.id, "recipe-publish")) {
      return sendRateLimit(response);
    }
    const recipe = await options.repository.findOwnedRecipe(response.locals.account.id, id);
    if (!recipe) return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    if (!diagnoseRecipe(recipe.document).valid) {
      return sendError(response, 409, "RECIPE_INVALID", "Recipe must validate before publication.");
    }
    const published = await options.repository.publishOwnedRecipe(
      response.locals.account.id,
      id,
      body.data.license,
      now(),
    );
    if (!published) return sendError(response, 409, "INVALID_LIFECYCLE", "Recipe cannot be published.");
    response.json({ recipe: published });
  }));

  app.post("/api/account/recipes/:id/unpublish", authenticate(sessions), asyncHandler(async (request, response) => {
    const id = parseRecipeId(firstParameter(request.params.id));
    if (!id || !emptyBodySchema.safeParse(request.body).success) {
      return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    }
    const recipe = await options.repository.unpublishOwnedRecipe(response.locals.account.id, id);
    if (!recipe) return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    response.json({ recipe });
  }));

  app.post("/api/account/recipes/:id/test-sessions", authenticate(sessions), asyncHandler(async (request, response) => {
    const id = parseRecipeId(firstParameter(request.params.id));
    if (!id || !emptyBodySchema.safeParse(request.body).success) {
      return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    }
    if (!consumeRecipeAttempt(recipeLimiters.testSession, request, response.locals.account.id, "recipe-test")) {
      return sendRateLimit(response);
    }
    const expiresAt = new Date(now().getTime() + 5 * 60_000);
    const issued = await options.repository.createPrivateTestToken(response.locals.account.id, id, expiresAt);
    if (!issued) return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    response.status(201).json({ recipeTestToken: issued.token, expiresAt: issued.expiresAt.toISOString() });
  }));

  app.get("/api/recipes", asyncHandler(async (request, response) => {
    if (!consumeRecipeAttempt(recipeLimiters.discovery, request, request.ip || "unknown", "recipe-discovery")) {
      return sendRateLimit(response);
    }
    const query = typeof request.query.query === "string" ? request.query.query.trim().slice(0, 80) : "";
    const cursor = typeof request.query.cursor === "string" && recipeIdSchema.safeParse(request.query.cursor).success
      ? request.query.cursor
      : undefined;
    const recipes = await options.repository.listPublishedRecipes({
      ...(query ? { query } : {}),
      ...(cursor ? { cursor } : {}),
    });
    response.json({ recipes, nextCursor: recipes.length === 20 ? recipes.at(-1)?.id ?? null : null });
  }));

  app.get("/api/recipes/:id", asyncHandler(async (request, response) => {
    const id = parseRecipeId(firstParameter(request.params.id));
    if (!id) return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    const recipe = await options.repository.findPublishedRecipe(id);
    if (!recipe) return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    const { document: _document, ...metadata } = recipe;
    response.json({ recipe: metadata });
  }));

  app.post("/api/recipes/:id/reports", authenticate(sessions), asyncHandler(async (request, response) => {
    const id = parseRecipeId(firstParameter(request.params.id));
    const body = reportSchema.safeParse(request.body);
    if (!id) return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    if (!body.success) return sendError(response, 400, "INVALID_REQUEST", "Invalid report.");
    if (!consumeRecipeAttempt(recipeLimiters.report, request, response.locals.account.id, "recipe-report")) {
      return sendRateLimit(response);
    }
    if (!await options.repository.findPublishedRecipe(id)) {
      return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    }
    const report = await options.repository.createRecipeReport({
      recipeId: id,
      reporterAccountId: response.locals.account.id,
      ...body.data,
    });
    if (!report) return sendError(response, 409, "ALREADY_REPORTED", "Recipe was already reported.");
    response.status(201).json({ report: { id: report.id, status: report.status, createdAt: report.createdAt } });
  }));

  app.get("/api/moderation/recipe-reports", authenticate(sessions), requireModerator(moderatorUsernames), asyncHandler(async (_request, response) => {
    response.json({ reports: await options.repository.listOpenRecipeReports() });
  }));

  app.post("/api/moderation/recipes/:id/remove", authenticate(sessions), requireModerator(moderatorUsernames), asyncHandler(async (request, response) => {
    const id = parseRecipeId(firstParameter(request.params.id));
    const body = moderationReasonSchema.safeParse(request.body);
    if (!id || !body.success || !await options.repository.removePublishedRecipe(id, body.data.reason, now())) {
      return sendError(response, 404, "NOT_FOUND", "Recipe not found.");
    }
    response.status(204).end();
  }));

  app.post("/api/moderation/recipes/:id/restore", authenticate(sessions), requireModerator(moderatorUsernames), asyncHandler(async (request, response) => {
    const id = parseRecipeId(firstParameter(request.params.id));
    if (!id || !emptyBodySchema.safeParse(request.body).success || !await options.repository.restoreRemovedRecipe(id)) {
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

function requireModerator(moderatorUsernames: ReadonlySet<string>) {
  return (_request: Request, response: Response, next: NextFunction) => {
    if (!moderatorUsernames.has(response.locals.account.normalizedUsername)) {
      sendError(response, 403, "MODERATOR_REQUIRED", "Moderator access required.");
      return;
    }
    next();
  };
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

function consumeRecipeAttempt(
  limiter: AttemptRateLimiter,
  request: Request,
  identity: string,
  namespace: string,
): boolean {
  const ip = request.ip || request.socket.remoteAddress || "unknown";
  return limiter.consume([`${namespace}:ip:${ip}`, `${namespace}:identity:${identity}`]);
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

function configuredModeratorUsernames(): string[] {
  return (process.env.MODERATOR_USERNAMES ?? "")
    .split(",")
    .map((username) => normalizeUsername(username))
    .filter(Boolean);
}

function sendRateLimit(response: Response) {
  response.setHeader("retry-after", "60");
  return sendError(response, 429, "RATE_LIMITED", "Too many requests. Try again later.");
}

function sendError(response: Response, status: number, code: string, message: string) {
  return response.status(status).json({ error: { code, message } });
}
