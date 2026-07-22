import { z } from "zod";

const usernameSchema = z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/);
const displayNameSchema = z.string().trim().min(1).max(32);
const passwordSchema = z.string().min(12).max(128);

export const registerSchema = z.strictObject({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});

export const loginSchema = z.strictObject({
  username: usernameSchema,
  password: passwordSchema,
});

export function normalizeUsername(username: string): string {
  return username.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}
