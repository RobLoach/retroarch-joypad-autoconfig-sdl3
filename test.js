'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const OUTPUT_DIR = path.join(__dirname, 'retroarch-joypad-autoconfig', 'sdl3');

function parseCfg(filename) {
  const raw = fs.readFileSync(path.join(OUTPUT_DIR, filename), 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([a-z0-9_]+)\s*=\s*"(.*)"$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

test('8BitDo Pro 2: header and IDs', () => {
  const cfg = parseCfg('8BitDo Pro 2_03000000c82d00000360000000000000.cfg');
  assert.equal(cfg.input_driver, 'sdl3');
  assert.equal(cfg.input_device, '8BitDo Pro 2');
  assert.equal(cfg.input_vendor_id, '11720'); // 0x2dc8
  assert.equal(cfg.input_product_id, '24579'); // 0x6003 (little-endian of 0360)
});

test('8BitDo Pro 2: face buttons are swapped (SDL Xbox -> RetroArch Nintendo)', () => {
  // SDL: a:b1, b:b0, x:b4, y:b3
  const cfg = parseCfg('8BitDo Pro 2_03000000c82d00000360000000000000.cfg');
  assert.equal(cfg.input_a_btn, '0'); // from SDL b:b0
  assert.equal(cfg.input_b_btn, '1'); // from SDL a:b1
  assert.equal(cfg.input_x_btn, '3'); // from SDL y:b3
  assert.equal(cfg.input_y_btn, '4'); // from SDL x:b4
});

test('8BitDo Pro 2: hat dpad and trigger-as-button', () => {
  // SDL: dpup:h0.1, dpright:h0.2, dpdown:h0.4, dpleft:h0.8, lefttrigger:b8
  const cfg = parseCfg('8BitDo Pro 2_03000000c82d00000360000000000000.cfg');
  assert.equal(cfg.input_up_btn, 'h0up');
  assert.equal(cfg.input_right_btn, 'h0right');
  assert.equal(cfg.input_down_btn, 'h0down');
  assert.equal(cfg.input_left_btn, 'h0left');
  assert.equal(cfg.input_l2_btn, '8');
  assert.equal(cfg.input_l2_axis, undefined); // trigger is a button, not an axis
});

test('PS4 Controller: axis trigger and analog sticks', () => {
  // SDL: lefttrigger:a3, righttrigger:a4, leftx:a0, lefty:a1, rightx:a2, righty:a5
  const cfg = parseCfg('PS4 Controller_030000004c050000c405000000000000.cfg');
  assert.equal(cfg.input_vendor_id, '1356'); // 0x054c (Sony)
  assert.equal(cfg.input_product_id, '1476'); // 0x05c4
  assert.equal(cfg.input_l2_axis, '+3');
  assert.equal(cfg.input_r2_axis, '+4');
  assert.equal(cfg.input_l2_btn, undefined);
  assert.equal(cfg.input_l_x_plus_axis, '+0');
  assert.equal(cfg.input_l_x_minus_axis, '-0');
  assert.equal(cfg.input_r_y_plus_axis, '+5');
  assert.equal(cfg.input_r_y_minus_axis, '-5');
});

test('PS4 Controller: face buttons swapped (a:b1, b:b2, x:b0, y:b3)', () => {
  const cfg = parseCfg('PS4 Controller_030000004c050000c405000000000000.cfg');
  assert.equal(cfg.input_a_btn, '2'); // SDL b:b2
  assert.equal(cfg.input_b_btn, '1'); // SDL a:b1
  assert.equal(cfg.input_x_btn, '3'); // SDL y:b3
  assert.equal(cfg.input_y_btn, '0'); // SDL x:b0
});

test('Cyber Gadget GameCube: inverted axis (~) swaps plus/minus', () => {
  // SDL: righty:a3~ — inverted axis should swap plus and minus halves
  const cfg = parseCfg('Cyber Gadget GameCube Controller_03000000260900008888000000000000.cfg');
  assert.equal(cfg.input_r_y_plus_axis, '-3');
  assert.equal(cfg.input_r_y_minus_axis, '+3');
  // lefty is plain a1 (not inverted) for comparison
  assert.equal(cfg.input_l_y_plus_axis, '+1');
  assert.equal(cfg.input_l_y_minus_axis, '-1');
});

test('Logitech WingMan: inverted-axis trigger', () => {
  // SDL: lefttrigger:a5~, righttrigger:a2~
  // Inverted full-axis form translated as a trigger should still emit an axis value.
  const cfg = parseCfg('Logitech WingMan Action Pad_030000006d0400000bc2000000000000.cfg');
  // Trigger uses positive half by default; ~ is stripped before classification.
  assert.equal(cfg.input_l2_axis, '+5');
  assert.equal(cfg.input_r2_axis, '+2');
});

test('8BitDo N64: button-backed half-axis (C-buttons as right stick)', () => {
  // SDL: +rightx:b9, -rightx:b4, +righty:b3, -righty:b8
  // C-buttons are digital buttons, not axes — map to _btn variants.
  const cfg = parseCfg('8BitDo N64_03000000c82d00000290000000000000.cfg');
  assert.equal(cfg.input_r_x_plus_btn, '9');
  assert.equal(cfg.input_r_x_minus_btn, '4');
  assert.equal(cfg.input_r_y_plus_btn, '3');
  assert.equal(cfg.input_r_y_minus_btn, '8');
  assert.equal(cfg.input_r_x_plus_axis, undefined);
  assert.equal(cfg.input_r_x_plus_btn_label, 'Right Stick Right');
});

test('Every emitted button line has a corresponding label line', () => {
  const cfg = parseCfg('8BitDo Pro 2_03000000c82d00000360000000000000.cfg');
  for (const key of Object.keys(cfg)) {
    if (key.startsWith('input_') && !key.endsWith('_label') &&
        key !== 'input_driver' && key !== 'input_device' &&
        key !== 'input_vendor_id' && key !== 'input_product_id') {
      assert.ok(cfg[`${key}_label`] !== undefined, `missing label for ${key}`);
    }
  }
});

test('Output directory contains only .cfg files and a reasonable count', () => {
  const files = fs.readdirSync(OUTPUT_DIR);
  assert.ok(files.length > 1000, `expected >1000 cfgs, got ${files.length}`);
  assert.ok(files.every((f) => f.endsWith('.cfg')), 'non-cfg file found');
});

test('Filenames use only portable characters', () => {
  // Reject anything Windows or POSIX would reject.
  // eslint-disable-next-line no-control-regex
  const forbiddenChars = /[<>:"/\\|?*\x00-\x1f]/;
  const reservedWindowsNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
  const offenders = [];
  for (const f of fs.readdirSync(OUTPUT_DIR)) {
    if (forbiddenChars.test(f)) offenders.push(`${f} (forbidden char)`);
    else if (/^\./.test(f)) offenders.push(`${f} (leading dot)`);
    else if (/[. ]$/.test(f.replace(/\.cfg$/, ''))) offenders.push(`${f} (trailing dot or space)`);
    else if (reservedWindowsNames.test(f)) offenders.push(`${f} (reserved Windows name)`);
  }
  assert.deepEqual(offenders, [], `non-portable filenames: ${offenders.slice(0, 5).join(', ')}`);
});
