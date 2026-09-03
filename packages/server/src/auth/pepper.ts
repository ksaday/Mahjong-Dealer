// The password pepper (docs/15_Security_Architecture.md §4.1, §9): a
// server-side secret combined with the password before hashing, held in
// the secret manager and never in the database. There is no secret
// manager integration yet (Phase 3/5 infra work), so this reads an
// environment variable — the interface a real secret manager would fill
// the same way.
const DEV_DEFAULT_PEPPER = "insecure-development-pepper-do-not-use-in-production";

export function getPasswordPepper(env: NodeJS.ProcessEnv = process.env): string {
  const pepper = env["PASSWORD_PEPPER"];
  if (env["NODE_ENV"] === "production") {
    // A production build refuses to start on a missing or placeholder
    // secret (NFR-044): starting on one looks healthy and is not.
    if (pepper === undefined || pepper.length === 0 || pepper === DEV_DEFAULT_PEPPER) {
      throw new Error(
        "PASSWORD_PEPPER is missing or is the development default; refusing to start in production (NFR-044)",
      );
    }
    return pepper;
  }
  return pepper ?? DEV_DEFAULT_PEPPER;
}
