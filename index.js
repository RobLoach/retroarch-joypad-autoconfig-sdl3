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

function buildCfg(entry) {
  const lines = [];
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

  for (const [sdlKey, sdlVal] of Object.entries(entry.mappings)) {
    const def = KEY_MAP[sdlKey];
    if (!def) continue;
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

  const labelLines = [];
  for (const k of writtenKeys) {
    if (LABELS[k]) labelLines.push(`${k}_label = "${LABELS[k]}"`);
  }
  if (labelLines.length) {
    lines.push('');
    lines.push(...labelLines);
  }

  return lines.join('\n') + '\n';
}

function sanitizeFilename(name) {
  return name.replace(/[\/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function main() {
  const text = fs.readFileSync(INPUT_PATH, 'utf8');
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let written = 0;
  let skipped = 0;
  for (const line of text.split('\n')) {
    const entry = parseLine(line);
    if (!entry) continue;
    if (entry.name === '*') continue;
    const cfg = buildCfg(entry);
    const safeName = sanitizeFilename(entry.name);
    const filename = `${safeName}_${entry.guid}.cfg`;
    const outPath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(outPath, cfg);
    written++;
  }
  console.log(`${written} files written to ${path.relative(ROOT, OUTPUT_DIR)}/`);
  if (skipped) console.log(`${skipped} entries skipped`);
}

main();
