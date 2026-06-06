#!/usr/bin/env node
// Runs after `npm install`. On a GLOBAL install (`npm i -g screenflow`) it
// auto-registers the screenflow MCP server with any AI agent detected on the
// machine (Claude Code, Codex, Cursor, Claude Desktop) so the whole thing is
// zero-config. It is a no-op for local/dev/CI installs and never fails the
// install — a broken postinstall must never block `npm install`.

if (process.env.npm_config_global !== 'true') process.exit(0);

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mcpInstallAction } = require('../dist/commands/mcpSetup.js');
  Promise.resolve(mcpInstallAction()).catch(() => {});
} catch {
  // dist not built or module missing — silently skip, never break the install.
}
