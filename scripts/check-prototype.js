'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

function fail(message) {
  console.error('[prototype-check] ' + message);
  process.exitCode = 1;
}

const html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('window.SKILL_FILES = {')) fail('Original embedded SKILL_FILES object is missing.');
const orderMatch = html.match(/window\.SKILL_ORDER\s*=\s*(\[[^\]]*\]);/);
if (!orderMatch) {
  fail('Original SKILL_ORDER array is missing or malformed.');
} else {
  try {
    const order = JSON.parse(orderMatch[1]);
    if (!Array.isArray(order) || order.length !== 24) {
      fail('Expected 24 embedded skills; found ' + (Array.isArray(order) ? order.length : 'invalid data') + '.');
    } else {
      console.log('[prototype-check] Verified ' + order.length + ' original embedded skills.');
    }
    for (const path of order) {
      if (!html.includes(JSON.stringify(path))) fail('Missing skill path: ' + path);
    }
  } catch (error) {
    fail('SKILL_ORDER is not valid JSON: ' + error.message);
  }
}

if (html.includes('__CF$cv$params') || html.includes('challenge-platform')) {
  fail('A hosting challenge script is still present in index.html.');
}
if (!html.includes('desktop.css') || !html.includes('desktop.js')) {
  fail('Desktop stylesheet or Electron adapter is not linked from index.html.');
}

const inlineScripts = [];
const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
let match;
while ((match = scriptPattern.exec(html))) {
  if (/\bsrc\s*=/i.test(match[1])) continue;
  if (match[2].trim()) inlineScripts.push(match[2]);
}
if (!inlineScripts.length) {
  fail('No inline prototype script was found.');
} else {
  inlineScripts.forEach((source, index) => {
    const result = spawnSync(process.execPath, ['--check', '-'], {
      input: source,
      encoding: 'utf8',
      windowsHide: true
    });
    if (result.status !== 0) {
      fail('Inline script ' + (index + 1) + ' failed Node syntax check:\n' + (result.stderr || result.stdout || 'Unknown syntax error'));
    }
  });
  if (process.exitCode !== 1) console.log('[prototype-check] Inline prototype script syntax is valid.');
}
