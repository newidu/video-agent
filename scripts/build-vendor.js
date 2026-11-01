'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

async function main() {
  const root = path.resolve(__dirname, '..');
  const assets = path.join(root, 'assets');
  fs.mkdirSync(assets, { recursive: true });

  await esbuild.build({
    entryPoints: [require.resolve('three')],
    bundle: true,
    minify: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'THREE',
    target: ['chrome120'],
    outfile: path.join(assets, 'three.bundle.js'),
    legalComments: 'none',
    sourcemap: false
  });

  const output = path.join(assets, 'three.bundle.js');
  const stat = fs.statSync(output);
  if (stat.size < 100000) {
    throw new Error('Three.js vendor bundle looks incomplete (' + stat.size + ' bytes).');
  }
  console.log('[vendor] Three.js browser bundle ready · ' + Math.round(stat.size / 1024) + ' KB');
}

main().catch(error => {
  console.error('[vendor] Build failed:', error);
  process.exitCode = 1;
});
