#!/usr/bin/env node
/*
 * grunglebird — inline / SVG color scan (issue #13, companion to stylelint.config.mjs).
 *
 * Stylelint only sees CSS inside <style> blocks. This closes the remaining color gap:
 * hardcoded color literals in HTML/SVG presentation attributes (style=, fill=, stroke=,
 * stop-color=) in non-exempt .astro files. Targeted to those attribute values on purpose
 * — a blunt whole-file hex grep false-positives on href #anchors, HTML entities, and JS.
 *
 * Exemptions mirror stylelint.config.mjs exactly: everything under src/pages/events/ is
 * an exempt poster page EXCEPT the events listing at src/pages/events/index.astro.
 * JS-CONSTRUCTED color strings (e.g. `#${hex}` built in a <script>) are out of scope —
 * impractical to detect deterministically; left to the review checklist in docs/styling.md.
 *
 * Exit 0 if clean, 1 (with file:line list) if any inline/SVG color literal is found.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

// The events listing is a normal page; every other file under src/pages/events/ is a
// sanctioned poster and exempt.
const EVENTS_DIR = join("src", "pages", "events") + sep;
const EVENTS_LISTING = join("src", "pages", "events", "index.astro");
const isExempt = (relPath) =>
  relPath.startsWith(EVENTS_DIR) && relPath !== EVENTS_LISTING;

// A color literal: #hex (3/4/6/8 digits) or an rgb()/rgba()/hsl()/hsla() function.
const COLOR = /#[0-9a-fA-F]{3,8}\b|(?:rgb|rgba|hsl|hsla)\s*\(/;
// A presentation attribute whose value can carry a color, capturing the value.
const ATTR = /\b(?:style|fill|stroke|stop-color)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/gi;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".astro")) files.push(full);
  }
  return files;
}

const violations = [];
for (const file of walk(SRC)) {
  const relPath = relative(ROOT, file);
  if (isExempt(relPath)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(ATTR)) {
      const value = m[1] ?? m[2] ?? m[3] ?? "";
      if (COLOR.test(value)) {
        violations.push(`${relPath}:${i + 1}  ${line.trim()}`);
      }
    }
  });
}

if (violations.length) {
  console.error(
    "Hardcoded color literal(s) in inline/SVG attributes (use a token via a <style> " +
      "block, or var(--…); see docs/styling.md):\n",
  );
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
