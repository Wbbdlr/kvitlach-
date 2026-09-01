// Prints an ADMIN_PASSWORD_HASH line for deploy/.env.
//
//   npm run hash-password -- 'the password'
//
// Takes the password as an argument rather than reading stdin because this is
// run once, over RDP, on a box with no other users. It does mean the password
// lands in shell history -- clear it, or prefix the command with a space if
// the shell is configured to skip those.
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("usage: npm run hash-password -- '<password>'");
  process.exit(1);
}
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 32).toString("hex");
console.log(`ADMIN_PASSWORD_HASH=scrypt$${salt}$${hash}`);
