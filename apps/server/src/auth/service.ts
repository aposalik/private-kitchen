import type { PrismaRepository } from "../db/repository.js";
import { hashPassword, verifyPassword, type ScryptParameters } from "./password.js";
import { normalizeUsername } from "./validation.js";

const DUMMY_SALT = Buffer.alloc(16, 7).toString("base64url");
const DUMMY_HASH = Buffer.alloc(32, 11).toString("base64url");

export class AuthenticationError extends Error {}
export class UsernameTakenError extends Error {}

export class AuthService {
  constructor(
    private readonly repository: PrismaRepository,
    private readonly scryptParameters: ScryptParameters,
  ) {}

  async register(input: { username: string; displayName: string; password: string }) {
    const username = input.username.trim();
    const credentials = await hashPassword(input.password, this.scryptParameters);
    try {
      return await this.repository.createAccount({
        username,
        normalizedUsername: normalizeUsername(username),
        displayName: input.displayName.trim(),
        ...credentials,
      });
    } catch (error) {
      if (isPrismaError(error, "P2002")) throw new UsernameTakenError("Username is unavailable");
      throw error;
    }
  }

  async login(input: { username: string; password: string }) {
    const account = await this.repository.findAccountByNormalizedUsername(normalizeUsername(input.username));
    const valid = account
      ? await verifyPassword(input.password, account.passwordHash, account.passwordSalt, this.scryptParameters)
      : await verifyPassword(input.password, DUMMY_HASH, DUMMY_SALT, this.scryptParameters);
    if (!account || !valid) throw new AuthenticationError("Invalid username or password");
    return account;
  }

}

function isPrismaError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
