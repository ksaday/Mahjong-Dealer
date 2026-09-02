// Lint-enforced dependency law (docs/03_System_Architecture.md §4.1, NFR-061)
// and the dealer-core purity contract (docs/03_System_Architecture.md §5,
// NFR-060). These gates are Phase 0 of IMPLEMENTATION_READINESS_CHECKLIST.md
// §6: they must exist before the code they constrain, not be added later.
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const internalPackages = [
  "@mahjong-dealer/shared",
  "@mahjong-dealer/dealer-core",
  "@mahjong-dealer/server",
  "@mahjong-dealer/web",
  "@mahjong-dealer/db",
];

function forbid(names, message) {
  return names.map((name) => ({ name, message }));
}

const base = {
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
  plugins: {
    "@typescript-eslint": tseslint,
  },
  rules: {
    ...tseslint.configs.recommended.rules,
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
  },
};

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.js"],
  },
  {
    ...base,
    files: ["packages/**/src/**/*.ts", "tests/**/*.ts"],
  },

  // shared may import nothing internal (docs/03 §4.1, §4.3).
  {
    ...base,
    files: ["packages/shared/src/**/*.ts"],
    rules: {
      ...base.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: forbid(
            internalPackages,
            "shared may import nothing internal — docs/03_System_Architecture.md §4.3.",
          ),
        },
      ],
    },
  },

  // dealer-core may import shared only, and no I/O of any kind
  // (docs/03 §4.1, §5; NFR-060, NFR-061). Test files are exempt from the
  // purity ban — a test reading a fixture with `node:fs` is not the library
  // acquiring I/O — but still subject to the dependency-law import ban.
  {
    ...base,
    files: ["packages/dealer-core/src/**/*.ts"],
    ignores: ["packages/dealer-core/src/**/*.test.ts"],
    rules: {
      ...base.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...forbid(
              ["@mahjong-dealer/server", "@mahjong-dealer/web", "@mahjong-dealer/db"],
              "dealer-core may import shared only — docs/03_System_Architecture.md §4.1.",
            ),
            ...forbid(
              [
                "fs",
                "node:fs",
                "fs/promises",
                "node:fs/promises",
                "net",
                "node:net",
                "http",
                "node:http",
                "https",
                "node:https",
                "dns",
                "node:dns",
                "child_process",
                "node:child_process",
                "worker_threads",
                "node:worker_threads",
                "ws",
                "pg",
                "fastify",
              ],
              "dealer-core is pure: no I/O of any kind — docs/03_System_Architecture.md §5, NFR-060.",
            ),
            // `crypto`/`node:crypto` is otherwise importable for pure hashing
            // (the shuffle commitment, docs/08_Shuffle_and_Deal_Architecture.md
            // §5.1) — only its *random* sources are banned; randomness is
            // injected by the host (docs/03 §5).
            {
              name: "crypto",
              importNames: ["randomBytes", "randomInt", "randomUUID", "randomFillSync", "webcrypto", "getRandomValues"],
              message: "dealer-core is pure — no randomness generation (docs/03 §5, NFR-060). Entropy is injected by the host.",
            },
            {
              name: "node:crypto",
              importNames: ["randomBytes", "randomInt", "randomUUID", "randomFillSync", "webcrypto", "getRandomValues"],
              message: "dealer-core is pure — no randomness generation (docs/03 §5, NFR-060). Entropy is injected by the host.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "process", message: "dealer-core is pure — no `process` access (docs/03 §5)." },
        { name: "setTimeout", message: "dealer-core is pure — no timers (docs/03 §5)." },
        { name: "setInterval", message: "dealer-core is pure — no timers (docs/03 §5)." },
        { name: "clearTimeout", message: "dealer-core is pure — no timers (docs/03 §5)." },
        { name: "clearInterval", message: "dealer-core is pure — no timers (docs/03 §5)." },
        { name: "console", message: "dealer-core is pure — no logging (docs/03 §5)." },
        { name: "fetch", message: "dealer-core is pure — no network I/O (docs/03 §5)." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: "dealer-core is pure — no `Math.random` (docs/03 §5, NFR-060). Entropy is injected by the host.",
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: "dealer-core is pure — no `Date` (docs/03 §5, NFR-060). Time is injected by the host.",
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "dealer-core is pure — no `Date.now` (docs/03 §5, NFR-060). Time is injected by the host.",
        },
      ],
    },
  },

  // dealer-core test files: the dependency-law import ban still applies —
  // a test importing `server`/`web`/`db` would be a real layering violation
  // — but not the purity ban, which governs the library itself.
  {
    ...base,
    files: ["packages/dealer-core/src/**/*.test.ts"],
    rules: {
      ...base.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: forbid(
            ["@mahjong-dealer/server", "@mahjong-dealer/web", "@mahjong-dealer/db"],
            "dealer-core may import shared only — docs/03_System_Architecture.md §4.1.",
          ),
        },
      ],
    },
  },

  // web may import shared only; never the core, the server, or db
  // (docs/03 §4.1 — this is what makes C-06 structural).
  {
    ...base,
    files: ["packages/web/src/**/*.ts", "packages/web/src/**/*.tsx"],
    rules: {
      ...base.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: forbid(
            ["@mahjong-dealer/dealer-core", "@mahjong-dealer/server", "@mahjong-dealer/db"],
            "web may import shared only — docs/03_System_Architecture.md §4.1 (C-06).",
          ),
        },
      ],
    },
  },

  // server may import shared, dealer-core, and db; never web.
  {
    ...base,
    files: ["packages/server/src/**/*.ts"],
    rules: {
      ...base.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: forbid(
            ["@mahjong-dealer/web"],
            "server may not import web — docs/03_System_Architecture.md §4.1.",
          ),
        },
      ],
    },
  },

  // db may import shared only.
  {
    ...base,
    files: ["packages/db/src/**/*.ts"],
    rules: {
      ...base.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: forbid(
            ["@mahjong-dealer/dealer-core", "@mahjong-dealer/server", "@mahjong-dealer/web"],
            "db may import shared only — docs/03_System_Architecture.md §4.1.",
          ),
        },
      ],
    },
  },
];
