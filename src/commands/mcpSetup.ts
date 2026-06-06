import os from 'os';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { bold, cyan, dim, green } from '../ui';

// Registers (or removes) the screenflow MCP server with whichever AI agents are
// installed on this machine. Safe and idempotent: only touches a tool when it's
// detected, never overwrites an existing screenflow entry, and never fails the
// caller (so it can run from a Homebrew post_install without breaking the brew).

const NAME = 'screenflow';

interface SetupOptions { dryRun?: boolean }

// Prefer the installed `screenflow-mcp` bin on PATH; fall back to running the
// built mcp.js directly (e.g. local dev before a global install).
function resolveCommand(): { command: string; args: string[] } {
  const onPath = spawnSync('sh', ['-c', 'command -v screenflow-mcp'], { stdio: 'ignore' }).status === 0;
  if (onPath) return { command: 'screenflow-mcp', args: [] };
  // dist/commands/mcpSetup.js → dist/mcp.js
  const mcpJs = path.join(__dirname, '..', 'mcp.js');
  return { command: 'node', args: [mcpJs] };
}

function hasCommand(bin: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }).status === 0;
}

type Result = { tool: string; status: 'added' | 'exists' | 'removed' | 'absent' | 'skipped'; detail?: string };

// ── Claude Code (managed via its own `claude` CLI) ───────────────────────────
function claudeCode(cmd: { command: string; args: string[] }, remove: boolean, dry: boolean): Result {
  if (!hasCommand('claude')) return { tool: 'Claude Code', status: 'absent' };
  if (remove) {
    if (!dry) spawnSync('claude', ['mcp', 'remove', NAME, '--scope', 'user'], { stdio: 'ignore' });
    return { tool: 'Claude Code', status: 'removed' };
  }
  const exists = spawnSync('claude', ['mcp', 'get', NAME], { stdio: 'ignore' }).status === 0;
  if (exists) return { tool: 'Claude Code', status: 'exists' };
  if (!dry) {
    spawnSync('claude', ['mcp', 'add', NAME, '--scope', 'user', '--', cmd.command, ...cmd.args], { stdio: 'ignore' });
  }
  return { tool: 'Claude Code', status: 'added' };
}

// ── Codex (~/.codex/config.toml) ─────────────────────────────────────────────
function codex(cmd: { command: string; args: string[] }, remove: boolean, dry: boolean): Result {
  const dir = path.join(os.homedir(), '.codex');
  if (!fs.existsSync(dir)) return { tool: 'Codex', status: 'absent' };
  const cfg = path.join(dir, 'config.toml');
  const content = fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : '';
  const header = `[mcp_servers.${NAME}]`;

  if (remove) {
    if (!content.includes(header)) return { tool: 'Codex', status: 'absent' };
    if (!dry) {
      // Drop the screenflow block (header + following non-blank, non-header lines).
      const lines = content.split('\n');
      const out: string[] = [];
      let skip = false;
      for (const line of lines) {
        if (line.trim() === header) { skip = true; continue; }
        if (skip && /^\s*\[/.test(line)) skip = false;
        if (!skip) out.push(line);
      }
      fs.writeFileSync(cfg, out.join('\n'));
    }
    return { tool: 'Codex', status: 'removed' };
  }

  if (content.includes(header)) return { tool: 'Codex', status: 'exists' };
  const argsLine = cmd.args.length ? `args = [${cmd.args.map(a => `"${a}"`).join(', ')}]\n` : '';
  const block = `${content.endsWith('\n') || content === '' ? '' : '\n'}\n${header}\ncommand = "${cmd.command}"\n${argsLine}`;
  if (!dry) fs.writeFileSync(cfg, content + block);
  return { tool: 'Codex', status: 'added', detail: cfg };
}

// ── JSON-config agents (Cursor, Claude Desktop) ──────────────────────────────
function jsonAgent(tool: string, file: string, requireDir: string, cmd: { command: string; args: string[] }, remove: boolean, dry: boolean): Result {
  if (!fs.existsSync(requireDir)) return { tool, status: 'absent' };
  let json: any = {};
  if (fs.existsSync(file)) {
    try { json = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); }
    catch { return { tool, status: 'skipped', detail: 'existing config is not valid JSON' }; }
  }

  if (remove) {
    if (!json.mcpServers || !json.mcpServers[NAME]) return { tool, status: 'absent' };
    if (!dry) {
      delete json.mcpServers[NAME];
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
    }
    return { tool, status: 'removed' };
  }

  if (json.mcpServers && json.mcpServers[NAME]) return { tool, status: 'exists' };
  if (!dry) {
    json.mcpServers = json.mcpServers || {};
    json.mcpServers[NAME] = cmd.args.length ? { command: cmd.command, args: cmd.args } : { command: cmd.command };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  }
  return { tool, status: 'added', detail: file };
}

function run(remove: boolean, opts: SetupOptions): void {
  const dry = Boolean(opts.dryRun);
  const cmd = resolveCommand();
  const home = os.homedir();

  const results: Result[] = [
    claudeCode(cmd, remove, dry),
    codex(cmd, remove, dry),
    jsonAgent('Cursor', path.join(home, '.cursor', 'mcp.json'), path.join(home, '.cursor'), cmd, remove, dry),
    jsonAgent(
      'Claude Desktop',
      path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      path.join(home, 'Library', 'Application Support', 'Claude'),
      cmd, remove, dry,
    ),
  ];

  const verb = remove ? 'Unregistering' : 'Registering';
  console.log(`${cyan('✦')} ${verb} the ${bold('screenflow')} MCP server${dry ? dim(' (dry run)') : ''}`);
  console.log(`  ${dim('command:')} ${cmd.command}${cmd.args.length ? ' ' + cmd.args.join(' ') : ''}\n`);

  const mark: Record<Result['status'], string> = {
    added: green('✓ registered'),
    removed: green('✓ removed'),
    exists: dim('• already registered'),
    absent: dim('— not installed'),
    skipped: dim('— skipped'),
  };
  for (const r of results) {
    console.log(`  ${r.tool.padEnd(16)} ${mark[r.status]}${r.detail && r.status !== 'absent' ? dim(`  ${r.detail}`) : ''}`);
  }

  const changed = results.some(r => r.status === 'added' || r.status === 'removed');
  const anyPresent = results.some(r => r.status !== 'absent');
  console.log('');
  if (!anyPresent) {
    console.log(`${dim('·')} No supported AI agent detected (Claude Code, Codex, Cursor, Claude Desktop).`);
  } else if (!remove && changed) {
    console.log(`${green('✓')} Done — restart your AI agent if it was running, then ask it to "frame this screenshot in an iPhone".`);
  } else if (!remove) {
    console.log(`${green('✓')} Already set up.`);
  }
}

export async function mcpInstallAction(opts: SetupOptions = {}): Promise<void> {
  run(false, opts);
}

export async function mcpUninstallAction(opts: SetupOptions = {}): Promise<void> {
  run(true, opts);
}
