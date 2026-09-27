import fs from 'node:fs';
import vm from 'node:vm';
import { appPath } from './app-path.mjs';

const html = fs.readFileSync(appPath, 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];

if (!html.includes('<!DOCTYPE html>')) {
  throw new Error(`${appPath} must be a complete HTML document.`);
}

if (!scripts.length) {
  throw new Error('No inline script blocks were found.');
}

for (const [index, match] of scripts.entries()) {
  new vm.Script(match[1], {
    filename: `${appPath}<script:${index + 1}>`
  });
}

console.log(`Checked ${scripts.length} inline script block(s) in ${appPath}.`);
