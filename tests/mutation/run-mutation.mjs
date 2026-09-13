import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync('PetaBoard.html', 'utf8');
const mutationDir = path.resolve('.mutation');
const reportsDir = path.resolve('reports');
fs.mkdirSync(mutationDir, { recursive: true });
fs.mkdirSync(reportsDir, { recursive: true });

const mutants = [
  {
    name: 'unsafe IDs are accepted',
    from: 'const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,96}$/;',
    to: 'const SAFE_ID_RE = /^.+$/;'
  },
  {
    name: 'calendar day rollover is allowed',
    from: 'if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;',
    to: 'if (false) return null;'
  },
  {
    name: 'invalid imported due dates are preserved',
    from: 'return date ? dateValue(date) : "";',
    to: 'return plain(value);'
  },
  {
    name: 'duplicate IDs are reused',
    from: 'if (isSafeId(candidate) && !usedIds.has(candidate)) {',
    to: 'if (isSafeId(candidate)) {'
  },
  {
    name: 'localStorage failures look successful',
    from: '      showStorageIssue("保存できませんでした。編集はこの画面に残っています。現在のボードを書き出すか、空き容量を確保して保存を再試行してください。", options.showError !== false);\n      return false;',
    to: '      showStorageIssue("保存できませんでした。編集はこの画面に残っています。現在のボードを書き出すか、空き容量を確保して保存を再試行してください。", options.showError !== false);\n      return true;'
  },
  {
    name: 'lossy checklist done normalization is ignored',
    from: '        || hasChecklistDoneNormalizationLoss(item.done, normalizedItem.done);',
    to: '        || false;',
    specs: ['tests/unit/state-normalization.spec.mjs']
  },
  {
    name: 'IME composing Escape is handled as normal Escape',
    from: 'return Boolean(event.isComposing || event.keyCode === 229 || event.which === 229);',
    to: 'return false;',
    specs: ['tests/e2e/input-composition-and-labels.spec.mjs']
  },
  {
    name: 'column title edits do not refresh filtered note lists',
    from: '      if (searchTerms().length) {\n        count.textContent = `${visibleNotesForColumn(column).length} / ${column.notes.length}`;\n        renderColumnNoteList(list, column);\n      }',
    to: '      if (false) {\n        count.textContent = `${visibleNotesForColumn(column).length} / ${column.notes.length}`;\n        renderColumnNoteList(list, column);\n      }',
    specs: ['tests/e2e/core-flow.spec.mjs']
  },
  {
    name: 'checklist focusout rebuilds rows before internal controls receive focus',
    from: '        if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;',
    to: '        renderChecklist(note);',
    specs: ['tests/e2e/checklist-touch.spec.mjs']
  },
  {
    name: 'keyboard-opened notes do not move focus into the drawer',
    from: '      els.noteTitle.focus();\n      if (focusTitle) els.noteTitle.select();',
    to: '      if (focusTitle) els.noteTitle.focus();\n      if (focusTitle) els.noteTitle.select();',
    specs: ['tests/e2e/core-flow.spec.mjs']
  },
  {
    name: 'modal Tab focus can escape to the background',
    from: '      if (event.key === "Tab") {\n        const modal = activeModal();',
    to: '      if (false) {\n        const modal = activeModal();',
    specs: ['tests/e2e/keyboard-navigation.spec.mjs']
  },
  {
    name: 'short viewport date popover can overflow',
    from: 'width: min(296px, calc(100vw - 24px));\n    max-height: calc(100dvh - 20px);\n    gap: 10px;\n    overflow: auto;',
    to: 'width: min(296px, calc(100vw - 24px));\n    gap: 10px;',
    specs: ['tests/e2e/responsive.spec.mjs']
  }
];

const results = [];

for (const mutant of mutants) {
  if (!source.includes(mutant.from)) {
    results.push({ name: mutant.name, status: 'not-run', reason: 'Mutation target was not found.' });
    continue;
  }
  const mutantHtml = path.join(mutationDir, `${mutant.name.replace(/[^A-Za-z0-9_-]+/g, '-')}.html`);
  fs.writeFileSync(mutantHtml, source.replace(mutant.from, mutant.to));
  const run = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['playwright', 'test', ...(mutant.specs || ['tests/unit']), '--project=chromium', '--reporter=line'],
    {
      encoding: 'utf8',
      env: { ...process.env, PETA_BOARD_HTML: mutantHtml },
      stdio: 'pipe'
    }
  );
  const killed = run.status !== 0;
  results.push({
    name: mutant.name,
    status: killed ? 'killed' : 'survived',
    exitCode: run.status,
    output: `${run.stdout}\n${run.stderr}`.slice(-4000)
  });
}

const killed = results.filter((result) => result.status === 'killed').length;
const runCount = results.filter((result) => result.status === 'killed' || result.status === 'survived').length;
const summary = {
  target: 'Targeted mutation checks for imported ID safety, date validation, count limits, save failure reporting, IME Escape handling, and short viewport popover containment',
  mutationScore: runCount ? Number((killed / runCount * 100).toFixed(1)) : 0,
  killed,
  survived: results.filter((result) => result.status === 'survived').length,
  notRun: results.filter((result) => result.status === 'not-run').length,
  results
};

fs.writeFileSync(path.join(reportsDir, 'mutation-summary.json'), JSON.stringify(summary, null, 2));
console.log(`Mutation score: ${summary.mutationScore}% (${killed}/${runCount} killed)`);
for (const result of results) {
  console.log(`${result.status.toUpperCase()}: ${result.name}`);
}

process.exit(summary.survived > 0 ? 1 : 0);
