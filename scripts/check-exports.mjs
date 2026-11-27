/* global process */
// Validates the packed tarball: publint (package.json / exports) and
// arethetypeswrong (types resolve for ESM and CJS consumers).
//
// `attw --pack` runs `npm pack` itself. Under `npm publish --dry-run`, npm
// exports `npm_config_dry_run=true` to lifecycle scripts, so that nested
// `npm pack` would write no tarball and attw would fail with ENOENT. The flag
// is cleared for the child processes only.
import { spawnSync } from "node:child_process";

const env = { ...process.env, npm_config_dry_run: "false" };
const steps = [
  ["publint", ["--strict"]],
  ["attw", ["--pack", ".", "--profile", "node16"]],
];

for (const [bin, args] of steps) {
  const { status, error } = spawnSync(bin, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (error) throw error;
  if (status !== 0) process.exit(status ?? 1);
}
