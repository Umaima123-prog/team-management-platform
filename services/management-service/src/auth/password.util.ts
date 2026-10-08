import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

/** Never store/compare plaintext - every password crosses this
 * boundary exactly once, right before it is persisted or checked. */
export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
