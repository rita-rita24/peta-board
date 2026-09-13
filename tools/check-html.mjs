import fs from 'node:fs';
import vm from 'node:vm';

const htmlPath = new URL('../PetaBoard.html', import.meta.url);
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];

if (!html.includes('<!DOCTYPE html>')) {
  throw new Error('PetaBoard.html must be a complete HTML document.');
}

if (!scripts.length) {
  throw new Error('No inline script blocks were found.');
}

for (const [index, match] of scripts.entries()) {
  new vm.Script(match[1], {
    filename: `PetaBoard.html<script:${index + 1}>`
  });
}

console.log(`Checked ${scripts.length} inline script block(s) in PetaBoard.html.`);
