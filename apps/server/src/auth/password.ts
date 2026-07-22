import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export interface ScryptParameters {
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLength: number;
  maxmem: number;
}

export const PRODUCTION_SCRYPT_PARAMETERS: ScryptParameters = {
  cost: 32_768,
  blockSize: 8,
  parallelization: 1,
  keyLength: 32,
  maxmem: 64 * 1_024 * 1_024,
};

export async function hashPassword(
  password: string,
  parameters: ScryptParameters = PRODUCTION_SCRYPT_PARAMETERS,
): Promise<{ passwordHash: string; passwordSalt: string }> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, parameters);
  return { passwordHash: hash.toString("base64url"), passwordSalt: salt.toString("base64url") };
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
  encodedSalt: string,
  parameters: ScryptParameters = PRODUCTION_SCRYPT_PARAMETERS,
): Promise<boolean> {
  try {
    const expected = Buffer.from(encodedHash, "base64url");
    const salt = Buffer.from(encodedSalt, "base64url");
    if (expected.length !== parameters.keyLength || salt.length < 16) return false;
    const actual = await derive(password, salt, parameters);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function derive(password: string, salt: Buffer, parameters: ScryptParameters): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, parameters.keyLength, {
      N: parameters.cost,
      r: parameters.blockSize,
      p: parameters.parallelization,
      maxmem: parameters.maxmem,
    }, (error, key) => error ? reject(error) : resolve(key));
  });
}
