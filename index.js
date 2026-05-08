'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const INPUT_PATH = path.join(ROOT, 'vendor', 'SDL_GameControllerDB', 'gamecontrollerdb.txt');
const OUTPUT_DIR = path.join(ROOT, 'retroarch-joypad-autoconfig', 'sdl3');

const HAT_DIR = { 1: 'up', 2: 'right', 4: 'down', 8: 'left' };

// SDL key -> { key: RetroArch key, kind }
// kind: 'button' (single value), 'trigger' (axis-or-button), 'axisPair' (split into +/-)
const KEY_MAP = {
  a: { key: 'input_b_btn', kind: 'button' },
  b: { key: 'input_a_btn', kind: 'button' },
  x: { key: 'input_y_btn', kind: 'button' },
  y: { key: 'input_x_btn', kind: 'button' },
  back: { key: 'input_select_btn', kind: 'button' },
  start: { key: 'input_start_btn', kind: 'button' },
  guide: { key: 'input_menu_toggle_btn', kind: 'button' },
  leftshoulder: { key: 'input_l_btn', kind: 'button' },
  rightshoulder: { key: 'input_r_btn', kind: 'button' },
  leftstick: { key: 'input_l3_btn', kind: 'button' },
  rightstick: { key: 'input_r3_btn', kind: 'button' },
  dpup: { key: 'input_up_btn', kind: 'button' },
  dpdown: { key: 'input_down_btn', kind: 'button' },
  dpleft: { key: 'input_left_btn', kind: 'button' },
  dpright: { key: 'input_right_btn', kind: 'button' },
  lefttrigger: { key: 'input_l2', kind: 'trigger' },
  righttrigger: { key: 'input_r2', kind: 'trigger' },
  leftx: { key: 'input_l_x', kind: 'axisPair' },
  lefty: { key: 'input_l_y', kind: 'axisPair' },
  rightx: { key: 'input_r_x', kind: 'axisPair' },
  righty: { key: 'input_r_y', kind: 'axisPair' },
};

// SDL half-axis bindings (e.g. "+leftx:+a3") map to a single RetroArch axis line.
const HALF_AXIS_MAP = {
  '+leftx':  'input_l_x_plus_axis',
  '-leftx':  'input_l_x_minus_axis',
  '+lefty':  'input_l_y_plus_axis',
  '-lefty':  'input_l_y_minus_axis',
  '+rightx': 'input_r_x_plus_axis',
  '-rightx': 'input_r_x_minus_axis',
  '+righty': 'input_r_y_plus_axis',
  '-righty': 'input_r_y_minus_axis',
};

// SDL bindings with no RetroArch equivalent — recognized but not emitted as bindings.
const NO_RETROARCH_EQUIVALENT = new Set([
  'paddle1', 'paddle2', 'paddle3', 'paddle4',
  'misc1', 'misc2', 'misc3', 'misc4', 'misc5', 'misc6',
  'touchpad', 'touchpad1', 'touchpad2', 'touchpad3', 'touchpad4',
]);

const LABELS = {
  input_a_btn: 'A',
  input_b_btn: 'B',
  input_x_btn: 'X',
  input_y_btn: 'Y',
  input_select_btn: 'Select',
  input_start_btn: 'Start',
  input_menu_toggle_btn: 'Menu',
  input_l_btn: 'L',
  input_r_btn: 'R',
  input_l2_btn: 'L2',
  input_r2_btn: 'R2',
  input_l2_axis: 'L2',
  input_r2_axis: 'R2',
  input_l3_btn: 'Left Stick',
  input_r3_btn: 'Right Stick',
  input_up_btn: 'D-Pad Up',
  input_down_btn: 'D-Pad Down',
  input_left_btn: 'D-Pad Left',
  input_right_btn: 'D-Pad Right',
  input_l_x_plus_axis: 'Left Stick Right',
  input_l_x_minus_axis: 'Left Stick Left',
  input_l_y_plus_axis: 'Left Stick Down',
  input_l_y_minus_axis: 'Left Stick Up',
  input_r_x_plus_axis: 'Right Stick Right',
  input_r_x_minus_axis: 'Right Stick Left',
  input_r_y_plus_axis: 'Right Stick Down',
  input_r_y_minus_axis: 'Right Stick Up',
};

function parseGuid(guid) {
  const lo = (offset) => {
    const b0 = guid.slice(offset, offset + 2);
    const b1 = guid.slice(offset + 2, offset + 4);
    return parseInt(b1 + b0, 16);
  };
  const vendorId = lo(8);
  const productId = lo(16);
  return {
    vendorId: vendorId ? String(vendorId) : null,
    productId: productId ? String(productId) : null,
  };
}

// Translate an SDL value into a RetroArch button-style string ("N", "+N", "-N", "hNup", etc.)
// Returns null if the value can't be represented as a button.
function valueToButton(sdlVal) {
  const v = sdlVal.replace(/~$/, '');
  let m;
  if ((m = v.match(/^b(\d+)$/))) return m[1];
  if ((m = v.match(/^h(\d+)\.(\d+)$/))) {
    const dir = HAT_DIR[Number(m[2])];
    return dir ? `h${m[1]}${dir}` : null;
  }
  if ((m = v.match(/^\+a(\d+)$/))) return `+${m[1]}`;
  if ((m = v.match(/^-a(\d+)$/))) return `-${m[1]}`;
  if ((m = v.match(/^a(\d+)$/))) return `+${m[1]}`;
  return null;
}

// Returns { plus, minus } for a full-axis value, or null otherwise.
function valueToAxisPair(sdlVal) {
  const inverted = sdlVal.endsWith('~');
  const v = inverted ? sdlVal.slice(0, -1) : sdlVal;
  const m = v.match(/^a(\d+)$/);
  if (!m) return null;
  const n = m[1];
  return inverted
    ? { plus: `-${n}`, minus: `+${n}` }
    : { plus: `+${n}`, minus: `-${n}` };
}

// Returns "+N" / "-N" for a half-axis value, or null if the value isn't an axis.
function valueToHalfAxis(sdlVal) {
  const inverted = sdlVal.endsWith('~');
  const v = inverted ? sdlVal.slice(0, -1) : sdlVal;
  let m;
  if ((m = v.match(/^\+a(\d+)$/))) return inverted ? `-${m[1]}` : `+${m[1]}`;
  if ((m = v.match(/^-a(\d+)$/))) return inverted ? `+${m[1]}` : `-${m[1]}`;
  if ((m = v.match(/^a(\d+)$/)))  return inverted ? `-${m[1]}` : `+${m[1]}`;
  return null;
}

// Returns { key, value } where key is either input_<x>_axis or input_<x>_btn.
function valueToTrigger(prefix, sdlVal) {
  const v = sdlVal.replace(/~$/, '');
  if (/^[bh]/.test(v)) {
    const btn = valueToButton(sdlVal);
    return btn ? { key: `${prefix}_btn`, value: btn } : null;
  }
  let m;
  if ((m = v.match(/^\+a(\d+)$/))) return { key: `${prefix}_axis`, value: `+${m[1]}` };
  if ((m = v.match(/^-a(\d+)$/))) return { key: `${prefix}_axis`, value: `-${m[1]}` };
  if ((m = v.match(/^a(\d+)$/))) return { key: `${prefix}_axis`, value: `+${m[1]}` };
  return null;
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const fields = trimmed.split(',').filter((f) => f.length > 0);
  if (fields.length < 2) return null;
  const guid = fields[0];
  const name = fields[1];
  if (!/^[0-9a-fA-F]{32}$/.test(guid)) return null;
  const mappings = {};
  let platform = null;
  for (let i = 2; i < fields.length; i++) {
    const idx = fields[i].indexOf(':');
    if (idx < 0) continue;
    const k = fields[i].slice(0, idx);
    const val = fields[i].slice(idx + 1);
    if (k === 'platform') platform = val;
    else mappings[k] = val;
  }
  return { guid, name, platform, mappings };
}

function countBindings(entry) {
  let count = 0;
  for (const sdlKey of Object.keys(entry.mappings)) {
    if (KEY_MAP[sdlKey] || HALF_AXIS_MAP[sdlKey]) count++;
  }
  return count;
}

function buildCfg(entry, unmappedTally, others = []) {
  const lines = [];
  const platformTag = (e) => (e.platform ? ` (${e.platform})` : '');
  lines.push(`# ${entry.name}: ${entry.guid}${platformTag(entry)}`);
  lines.push(`# Generated by https://github.com/robloach/retroarch-joypad-autoconfig-sdl3`);

  if (others && others.length > 0) {
    lines.push('');
    for (const o of others) {
      lines.push(`# Other GUID: ${o.guid}${platformTag(o)}`);
    }
  }

  lines.push('');
  lines.push(`input_driver = "sdl3"`);
  lines.push(`input_device = "${entry.name}"`);
  const ids = parseGuid(entry.guid);
  if (ids.vendorId) lines.push(`input_vendor_id = "${ids.vendorId}"`);
  if (ids.productId) lines.push(`input_product_id = "${ids.productId}"`);
  lines.push('');

  const writtenKeys = [];
  const writeKV = (key, value) => {
    lines.push(`${key} = "${value}"`);
    writtenKeys.push(key);
  };

  // Iterate KEY_MAP (not entry.mappings) so output order is stable across upstream reorderings.
  for (const sdlKey of Object.keys(KEY_MAP)) {
    const sdlVal = entry.mappings[sdlKey];
    if (sdlVal === undefined) continue;
    const def = KEY_MAP[sdlKey];
    if (def.kind === 'button') {
      const v = valueToButton(sdlVal);
      if (v !== null) writeKV(def.key, v);
    } else if (def.kind === 'trigger') {
      const t = valueToTrigger(def.key, sdlVal);
      if (t) writeKV(t.key, t.value);
    } else if (def.kind === 'axisPair') {
      const pair = valueToAxisPair(sdlVal);
      if (pair) {
        writeKV(`${def.key}_plus_axis`, pair.plus);
        writeKV(`${def.key}_minus_axis`, pair.minus);
      }
    }
  }

  // Half-axis bindings — only emit if the full-axis pair didn't already cover this key.
  for (const sdlKey of Object.keys(HALF_AXIS_MAP)) {
    const sdlVal = entry.mappings[sdlKey];
    if (sdlVal === undefined) continue;
    const raKey = HALF_AXIS_MAP[sdlKey];
    if (writtenKeys.includes(raKey)) continue;
    const v = valueToHalfAxis(sdlVal);
    if (v !== null) writeKV(raKey, v);
  }

  const labelLines = [];
  for (const k of writtenKeys) {
    if (LABELS[k]) labelLines.push(`${k}_label = "${LABELS[k]}"`);
  }
  if (labelLines.length) {
    lines.push('');
    lines.push(...labelLines);
  }

  const unmapped = [];
  for (const sdlKey of Object.keys(entry.mappings)) {
    if (sdlKey === 'crc') continue;
    if (KEY_MAP[sdlKey]) continue;
    if (HALF_AXIS_MAP[sdlKey] && writtenKeys.includes(HALF_AXIS_MAP[sdlKey])) continue;
    unmapped.push(`${sdlKey}=${entry.mappings[sdlKey]}`);
    if (unmappedTally) {
      const bucket = NO_RETROARCH_EQUIVALENT.has(sdlKey)
        ? unmappedTally.noEquivalent
        : unmappedTally.unhandled;
      bucket.set(sdlKey, (bucket.get(sdlKey) || 0) + 1);
    }
  }
  if (unmapped.length) {
    lines.push('');
    for (const u of unmapped) {
      lines.push(`# Unmapped Binding: ${u}`);
    }
  }

  return lines.join('\n') + '\n';
}

function sanitizeFilename(name) {
  const cleaned = name
    .replace(/[\/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim();
  return cleaned || 'controller';
}

function readInput() {
  try {
    return fs.readFileSync(INPUT_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Source DB not found at ${path.relative(ROOT, INPUT_PATH)}`);
      console.error(`Run "npm run update-vendor" to fetch the SDL_GameControllerDB submodule.`);
      process.exit(1);
    }
    throw err;
  }
}

function main() {
  const text = readInput();
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let skipped = 0;
  const collisions = [];
  const unmappedTally = { noEquivalent: new Map(), unhandled: new Map() };
  const seen = new Map();

  // Parse and group entries by (vendor_id, product_id). Entries lacking either form their own group.
  const groups = new Map();
  let solo = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const entry = parseLine(line);
    if (!entry) {
      if (trimmed && !trimmed.startsWith('#')) skipped++;
      continue;
    }
    if (entry.name === '*') {
      skipped++;
      continue;
    }
    const ids = parseGuid(entry.guid);
    const key = ids.vendorId && ids.productId
      ? `vp:${ids.vendorId}:${ids.productId}`
      : `solo:${solo++}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  // For each group, pick the entry with the most usable bindings (tie-break by guid).
  let written = 0;
  let deduped = 0;
  for (const groupEntries of groups.values()) {
    groupEntries.sort((a, b) => {
      const diff = countBindings(b) - countBindings(a);
      return diff !== 0 ? diff : a.guid.localeCompare(b.guid);
    });
    const [best, ...others] = groupEntries;
    deduped += others.length;
    const filename = `${sanitizeFilename(best.name)}_${best.guid}.cfg`;
    if (seen.has(filename)) {
      collisions.push({
        filename,
        prev: seen.get(filename),
        next: best.platform || 'unknown',
      });
      skipped++;
      continue;
    }
    const cfg = buildCfg(best, unmappedTally, others);
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), cfg);
    seen.set(filename, best.platform || 'unknown');
    written++;
  }
  console.log(`${written} files written to ${path.relative(ROOT, OUTPUT_DIR)}/`);
  if (deduped) console.log(`${deduped} entries deduplicated (lower binding count for same vendor+product)`);
  if (skipped) console.log(`${skipped} entries skipped (unparseable or wildcard)`);
  if (collisions.length) {
    console.log(`${collisions.length} filename collisions (kept first):`);
    for (const c of collisions.slice(0, 10)) {
      console.log(`  ${c.filename} (${c.prev} vs ${c.next})`);
    }
    if (collisions.length > 10) {
      console.log(`  ...and ${collisions.length - 10} more`);
    }
  }
  const formatTally = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`)
      .join(', ');
  if (unmappedTally.noEquivalent.size) {
    console.log(`SDL bindings with no RetroArch equivalent (skipped): ${formatTally(unmappedTally.noEquivalent)}`);
  }
  if (unmappedTally.unhandled.size) {
    console.log(`SDL bindings the script doesn't handle yet: ${formatTally(unmappedTally.unhandled)}`);
  }
}

main();
