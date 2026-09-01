// forge-workflow bridge for Oh My Pi (omp).
//
// WHAT OMP ALREADY DOES WITHOUT THIS FILE. omp discovers installed Claude Code
// marketplace plugins directly out of ~/.claude/plugins/cache/ and maps their
// skills, slash commands, rules, and MCP servers into its own capability
// registry. Verified by observation: with forge installed, an omp session in a
// forge project lists `forge`, `forge-code`, `forge-design`, `forge-env`,
// `forge-spec`, and `forge-standards` among its loaded skills, with no adapter
// and no configuration. It also loads tool-level hooks from a plugin's
// hooks/pre/ and hooks/post/ directories.
//
// WHAT IT DOES NOT DO, AND WHY THIS EXISTS. omp's hook capability models only
// `pre` and `post` tool hooks. It never reads hooks/hooks.json, and it has no
// SessionStart or Stop equivalent. Two of forge's four hooks therefore have no
// home in omp, and one of them is the one that matters most: the SessionStart
// hook is what puts the project's live state in front of the model, so without
// it "please continue" in a fresh omp session continues nothing.
//
// This bridge subscribes to omp's own lifecycle events and shells out to the
// SAME two node scripts the Claude Code hooks run. It translates payloads; it
// does not reimplement anything. There is one copy of the logic and it lives in
// the plugin.
//
// INSTALL
//   Copy this file to ~/.omp/agent/extensions/forge-bridge.ts
//   Restart omp. Extensions are discovered at startup.
//   Verify: start omp in a forge project and confirm the first reply is aware
//   of the phase, the gate, and the next action without being told to read
//   CONTINUE.md.
//
// It is inert outside a forge project: session-start.js prints nothing when
// there is no CONTINUE.md, and this adds no message when it prints nothing.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PLUGIN = "forge-workflow@dailen";

/**
 * Resolve the forge install the way Claude Code itself resolves it, by reading
 * the registry rather than by listing the cache directory.
 *
 * This distinction is not academic. On the machine this was written for, the
 * cache held 0.1.0, 1.1.2, 1.2.0, 1.3.0 and 1.4.0, and the highest present is
 * the natural thing to assume is live. The registry resolved the project to
 * 0.1.0, a build seven versions old. A project-scope entry also shadows the
 * user-scope one, so the project's own entry is preferred here for the same
 * reason Claude Code prefers it.
 */
function resolveForgeRoot(cwd: string): string | null {
  const registry = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(registry, "utf8"));
  } catch {
    return null;
  }

  const entries = parsed?.plugins?.[PLUGIN];
  if (!Array.isArray(entries) || entries.length === 0) return null;

  const withinProject = (e: any) =>
    typeof e?.projectPath === "string" &&
    path.resolve(cwd).toLowerCase().startsWith(path.resolve(e.projectPath).toLowerCase());

  const chosen =
    entries.find((e: any) => e?.scope === "project" && withinProject(e)) ||
    entries.find((e: any) => e?.scope === "user") ||
    entries[0];

  const root = chosen?.installPath;
  if (typeof root !== "string" || !fs.existsSync(root)) return null;
  return root;
}

/**
 * Find a real node interpreter.
 *
 * `process.execPath` is the obvious choice and it is WRONG here. Inside omp it
 * is omp's own compiled binary, so handing it a .js path runs omp again rather
 * than running the script, and the bridge silently produces nothing. That is
 * how this failed the first time it was tested: the resolver was correct, the
 * hook was correct, and it injected nothing because it never ran node.
 */
let cachedNode: string | null | undefined;
function nodeBin(): string | null {
  if (cachedNode !== undefined) return cachedNode;

  const own = path.basename(process.execPath).toLowerCase();
  if (own === "node" || own === "node.exe") {
    cachedNode = process.execPath;
    return cachedNode;
  }

  const names = process.platform === "win32" ? ["node.exe", "node.cmd", "node"] : ["node"];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate)) {
          cachedNode = candidate;
          return cachedNode;
        }
      } catch {
        // an unreadable PATH entry is not a reason to stop looking
      }
    }
  }

  cachedNode = null;
  return null;
}

/**
 * Run one forge hook script and return its stdout.
 *
 * Every failure is swallowed to an empty string on purpose. A bridge that
 * throws would take the whole turn down over a bookkeeping script, which is a
 * worse outcome than the missing context it was trying to supply. The Claude
 * Code hooks these mirror make the same trade in their own headers.
 */
function runHook(root: string, script: string, cwd: string, payload: unknown): string {
  const node = nodeBin();
  if (!node) return "";
  const file = path.join(root, "scripts", script);
  if (!fs.existsSync(file)) return "";
  try {
    return execFileSync(node, [file], {
      cwd,
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export default function (pi: any) {
  let injectedForSession = false;
  let pendingStopReport = "";
  let cwd = process.cwd();

  const forgeRoot = () => resolveForgeRoot(cwd);

  pi.on("session_start", (_event: any, ctx: any) => {
    // A new session means the state block is owed again. Resolve the working
    // directory from omp rather than from process.cwd(), since --cwd and
    // --add-dir both move it.
    cwd = ctx?.cwd || ctx?.workingDirectory || cwd;
    injectedForSession = false;
    pendingStopReport = "";
  });

  pi.on("session_switch", (_event: any, ctx: any) => {
    cwd = ctx?.cwd || ctx?.workingDirectory || cwd;
    injectedForSession = false;
  });

  // The SessionStart equivalent. before_agent_start fires once per user prompt
  // and is the only event whose result can put a message in front of the model,
  // so the injection happens on the first prompt of a session rather than at
  // session_start itself.
  pi.on("before_agent_start", (_event: any, ctx: any) => {
    cwd = ctx?.cwd || ctx?.workingDirectory || cwd;
    const root = forgeRoot();
    if (!root) return undefined;

    const parts: string[] = [];

    if (!injectedForSession) {
      injectedForSession = true;
      const block = runHook(root, "session-start.js", cwd, {
        cwd,
        hook_event_name: "SessionStart",
        source: "startup",
      });
      if (block) parts.push(block);
    }

    // The Stop hook's report, carried forward. omp's agent_end cannot inject,
    // so the resumability warning is delivered at the top of the next turn
    // instead of at the end of the last one. It is the same text and the same
    // script; only the moment moves.
    if (pendingStopReport) {
      parts.push(pendingStopReport);
      pendingStopReport = "";
    }

    if (parts.length === 0) return undefined;
    return { message: parts.join("\n\n") };
  });

  // The Stop equivalent. willContinue means omp has already scheduled another
  // loop, so the turn has not actually settled and the resumability check would
  // fire against a half-finished state.
  pi.on("agent_end", (event: any) => {
    if (event?.willContinue === true) return;
    const root = forgeRoot();
    if (!root) return;
    const report = runHook(root, "stop-check.js", cwd, {
      cwd,
      hook_event_name: "Stop",
    });
    if (report) pendingStopReport = report;
  });
}
