#!/usr/bin/env node
"use strict";

/*
 * Shared parsing and validation for the forge record set. Required by
 * forge-index.js, forge-views.js, forge-records-lint.js, and
 * forge-records-migrate.js, all of which are copied into .forge/ together.
 *
 * This is a library, not a command. It exits nothing and prints nothing.
 *
 * DESIGN NOTE on the front matter parser. It is a deliberately small subset of
 * YAML: `key: value`, `key: [a, b]`, `key: null`, and quoted scalars. It is not
 * a YAML implementation and must not grow into one. A record whose front matter
 * needs more than this is a record carrying structure that belongs in its body,
 * and the parser reports it rather than guessing. Guessing is how a typo
 * becomes a silently ignored edge, which is the failure this whole design
 * exists to prevent.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// The closed field set. A field outside this is a lint error by construction:
// nothing downstream reads an unknown key, so accepting one would mean a typo
// in `supersedes` silently drops a supersession edge.
const FIELDS = {
  id: "string",
  type: "enum",
  status: "enum",
  date: "date",
  title: "string",
  closes: "idlist",
  satisfies: "idlist",
  supersedes: "idornull",
  superseded_by: "idornull",
  decided_in: "idornull",
  severity: "enum",
};

const REQUIRED = ["id", "type", "status", "date", "title"];

const TYPES = ["decision", "task", "requirement", "uxd"];

const STATUS_BY_TYPE = {
  decision: ["live", "superseded"],
  task: ["open", "in-progress", "closed", "abandoned"],
  requirement: ["proposed", "approved", "implemented", "superseded"],
  uxd: ["open", "fixed", "slipped", "superseded"],
};

const SEVERITIES = ["blocks", "degrades", "finish"];

// Which statuses count as still-open work, per type. Used by the index and the
// open-work view so the two cannot disagree about what "open" means.
const OPEN_STATUS = {
  decision: [],
  task: ["open", "in-progress"],
  requirement: ["proposed", "approved"],
  uxd: ["open", "slipped"],
};

const TYPE_DIRS = {
  decision: "decisions",
  task: "tasks",
  requirement: "requirements",
  uxd: "uxd",
};

// Shape only. The vocabulary of prefixes is the project's, declared in
// VOCABULARY.md, because requirement IDs carry a per-domain subcode the plugin
// cannot know in advance: FR-GW, FR-TKT, FR-MDV. A hardcoded enum here would
// reject most real records.
// The trailing lowercase letter is not decoration. Real projects split a task
// into T-006a, T-006b, T-006c as the work turns out to have parts, and on the
// project this was measured against 845 ID occurrences carried such a suffix.
// A shape that rejected them would have silently dropped every edge naming a
// split task, which is the failure this design exists to prevent.
const ID_SHAPE = /^[A-Z]{1,5}(-[A-Z]{2,5})?-[0-9]{1,5}[a-z]?$/;

function isId(value) {
  return typeof value === "string" && ID_SHAPE.test(value);
}

function prefixOf(id) {
  const m = /^([A-Z]{1,5}(?:-[A-Z]{2,5})?)-[0-9]{1,5}[a-z]?$/.exec(id);
  return m ? m[1] : null;
}

/*
 * Split a scalar off a `key: value` line. Returns the raw string with
 * surrounding quotes removed, or null for an explicitly null value.
 */
function scalar(raw) {
  const text = raw.trim();
  if (text === "" || text === "null" || text === "~") {
    return null;
  }
  const quoted = /^(['"])([\s\S]*)\1$/.exec(text);
  return quoted ? quoted[2] : text;
}

function inlineList(raw) {
  const text = raw.trim();
  if (text === "" || text === "null") {
    return [];
  }
  const m = /^\[([\s\S]*)\]$/.exec(text);
  if (!m) {
    return undefined;
  }
  const inner = m[1].trim();
  if (inner === "") {
    return [];
  }
  return inner.split(",").map((part) => {
    const s = scalar(part);
    return s === null ? "" : s;
  });
}

/*
 * Parse the front matter block of one record.
 *
 * Returns { data, body, errors }. Errors carry a line number relative to the
 * file so a report can point at the offending line rather than the file.
 */
function parseFrontMatter(text, file) {
  const errors = [];
  const lines = text.split(/\r?\n/);

  if (lines[0] !== "---") {
    errors.push({ file, line: 1, message: "file does not open with a --- front matter fence" });
    return { data: {}, body: text, errors };
  }

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    errors.push({ file, line: 1, message: "front matter fence is never closed" });
    return { data: {}, body: text, errors };
  }

  const data = {};
  let pendingKey = null;

  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;

    if (line.trim() === "") {
      continue;
    }

    // A block list item belonging to the previous key.
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item) {
      if (pendingKey === null) {
        errors.push({ file, line: lineNo, message: "list item with no key above it" });
        continue;
      }
      if (!Array.isArray(data[pendingKey])) {
        data[pendingKey] = [];
      }
      const s = scalar(item[1]);
      data[pendingKey].push(s === null ? "" : s);
      continue;
    }

    const pair = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(.*)$/.exec(line);
    if (!pair) {
      errors.push({
        file,
        line: lineNo,
        message: "not a `key: value` line, and this parser is a deliberate YAML subset",
      });
      pendingKey = null;
      continue;
    }

    const key = pair[1];
    const rest = pair[2];

    if (Object.prototype.hasOwnProperty.call(data, key)) {
      errors.push({ file, line: lineNo, message: "duplicate key `" + key + "`" });
    }

    const kind = FIELDS[key];
    if (kind === "idlist") {
      const list = inlineList(rest);
      if (list === undefined) {
        // Opens a block list; items arrive on the following lines.
        if (rest.trim() !== "") {
          errors.push({ file, line: lineNo, message: "`" + key + "` must be [a, b] or a block list" });
          pendingKey = null;
          continue;
        }
        data[key] = [];
        pendingKey = key;
        continue;
      }
      data[key] = list;
      pendingKey = null;
      continue;
    }

    data[key] = scalar(rest);
    pendingKey = null;
  }

  return { data, body: lines.slice(end + 1).join("\n").replace(/^\n+/, ""), errors };
}

/*
 * Validate one parsed record in isolation. Cross-record checks (edges resolve,
 * supersession is acyclic) belong to the linter, which is the only caller that
 * holds the whole set.
 */
function validateRecord(rec, vocabulary) {
  const problems = [];
  const file = rec.file;
  const d = rec.data;

  for (const key of Object.keys(d)) {
    if (!Object.prototype.hasOwnProperty.call(FIELDS, key)) {
      problems.push({ file, field: key, severity: "error", message: "field is not in the closed set" });
    }
  }

  for (const key of REQUIRED) {
    if (d[key] === undefined || d[key] === null || d[key] === "") {
      problems.push({ file, field: key, severity: "error", message: "required field is missing" });
    }
  }

  if (d.type !== undefined && d.type !== null && !TYPES.includes(d.type)) {
    problems.push({
      file,
      field: "type",
      severity: "error",
      message: "`" + d.type + "` is not one of " + TYPES.join(", "),
    });
  }

  if (d.type && STATUS_BY_TYPE[d.type] && d.status) {
    if (!STATUS_BY_TYPE[d.type].includes(d.status)) {
      problems.push({
        file,
        field: "status",
        severity: "error",
        message: "`" + d.status + "` is not legal for type " + d.type + " (" + STATUS_BY_TYPE[d.type].join(", ") + ")",
      });
    }
  }

  if (d.date && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d.date)) {
    problems.push({ file, field: "date", severity: "error", message: "date must be ISO yyyy-mm-dd" });
  }

  if (d.id && !isId(d.id)) {
    problems.push({ file, field: "id", severity: "error", message: "`" + d.id + "` is not a legal ID shape" });
  }

  if (d.severity !== undefined && d.severity !== null) {
    if (d.type !== "uxd") {
      problems.push({ file, field: "severity", severity: "error", message: "severity belongs to uxd records only" });
    } else if (!SEVERITIES.includes(d.severity)) {
      problems.push({
        file,
        field: "severity",
        severity: "error",
        message: "`" + d.severity + "` is not one of " + SEVERITIES.join(", "),
      });
    }
  }

  if (d.type === "uxd" && (d.severity === undefined || d.severity === null)) {
    problems.push({ file, field: "severity", severity: "error", message: "a uxd record requires a severity" });
  }

  for (const key of ["closes", "satisfies"]) {
    const list = d[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      problems.push({ file, field: key, severity: "error", message: "must be a list" });
      continue;
    }
    for (const value of list) {
      if (!isId(value)) {
        problems.push({ file, field: key, severity: "error", message: "`" + value + "` is not a legal ID shape" });
      }
    }
  }

  for (const key of ["supersedes", "superseded_by", "decided_in"]) {
    const value = d[key];
    if (value === undefined || value === null) continue;
    if (!isId(value)) {
      problems.push({ file, field: key, severity: "error", message: "`" + value + "` is not a legal ID shape" });
    }
  }

  if (d.supersedes && d.id && d.supersedes === d.id) {
    problems.push({ file, field: "supersedes", severity: "error", message: "a record cannot supersede itself" });
  }

  // The declared vocabulary is a warning, never a failure. The first run against
  // an existing project finds prose that merely looks like an ID: SHA-256
  // matches the shape. An unusable linter on day one gets switched off.
  if (vocabulary && d.id && isId(d.id)) {
    const prefix = prefixOf(d.id);
    if (prefix && !vocabulary.has(prefix)) {
      problems.push({
        file,
        field: "id",
        severity: "warning",
        message: "prefix `" + prefix + "` is not declared in VOCABULARY.md",
      });
    }
  }

  return problems;
}

/*
 * Read VOCABULARY.md. The format is a markdown table whose first column is the
 * prefix. A missing file is not an error: it yields an empty vocabulary, and
 * every prefix then warns once, which is the correct first-run behaviour.
 */
function loadVocabulary(recordsDir) {
  const file = path.join(recordsDir, "VOCABULARY.md");
  const vocabulary = new Map();
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return vocabulary;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\|\s*([A-Z][A-Z-]*)\s*\|\s*([a-z]+)\s*\|(.*)\|\s*$/.exec(line.trim());
    if (!m) continue;
    if (!TYPES.includes(m[2])) continue;
    vocabulary.set(m[1], { type: m[2], meaning: m[3].trim() });
  }
  return vocabulary;
}

/*
 * Read the whole record set. Returns records in stable ID order so every
 * consumer, and therefore every generated file, is deterministic.
 */
function readRecords(recordsDir) {
  const records = [];
  const errors = [];

  for (const type of TYPES) {
    const dir = path.join(recordsDir, TYPE_DIRS[type]);
    let names;
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
    } catch (err) {
      continue;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      let text;
      try {
        text = fs.readFileSync(file, "utf8");
      } catch (err) {
        errors.push({ file, line: 0, message: "could not be read: " + err.message });
        continue;
      }
      const parsed = parseFrontMatter(text, file);
      errors.push(...parsed.errors);
      records.push({
        file,
        dirType: type,
        basename: name.replace(/\.md$/, ""),
        data: parsed.data,
        body: parsed.body,
      });
    }
  }

  records.sort((a, b) => String(a.data.id).localeCompare(String(b.data.id)));
  return { records, errors };
}

function isLive(rec) {
  const by = rec.data.superseded_by;
  return by === undefined || by === null || by === "";
}

function isOpen(rec) {
  const statuses = OPEN_STATUS[rec.data.type] || [];
  return isLive(rec) && statuses.includes(rec.data.status);
}

/*
 * Hash of the record set's identity and edges, bodies excluded, so a body edit
 * does not invalidate an index whose contents did not change.
 */
function recordsHash(records) {
  const h = crypto.createHash("sha256");
  for (const rec of records) {
    h.update(path.basename(rec.file));
    h.update(" ");
    for (const key of Object.keys(FIELDS)) {
      const value = rec.data[key];
      h.update(key + "=" + (Array.isArray(value) ? value.join(",") : String(value === undefined ? "" : value)));
      h.update(" ");
    }
  }
  return "sha256:" + h.digest("hex");
}

module.exports = {
  FIELDS,
  REQUIRED,
  TYPES,
  STATUS_BY_TYPE,
  SEVERITIES,
  OPEN_STATUS,
  TYPE_DIRS,
  ID_SHAPE,
  isId,
  prefixOf,
  parseFrontMatter,
  validateRecord,
  loadVocabulary,
  readRecords,
  isLive,
  isOpen,
  recordsHash,
};
