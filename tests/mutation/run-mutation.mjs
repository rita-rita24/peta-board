import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { appPath } from '../../tools/app-path.mjs';

const source = fs.readFileSync(appPath, 'utf8');
const sourceHash = createHash('sha256').update(source).digest('hex');
const mutationDir = path.resolve('.mutation');
const reportsDir = path.resolve('reports');
fs.mkdirSync(mutationDir, { recursive: true });
fs.mkdirSync(reportsDir, { recursive: true });

const mutants = [
  {
    name: 'equivalent search terms rebuild cards',
    from: 'if (previousTerms.length !== nextTerms.length || nextTerms.some((term) => !previousTerms.includes(term))) {',
    to: 'if (previousTerms !== nextTerms) {',
    specs: ['tests/e2e/continuity-edge-cases.spec.mjs'],
    grep: 'equivalent search'
  },
  {
    name: 'calendar today stays stale after midnight',
    from: 'cell.classList.toggle("is-today", cell.dataset.date === todayValue);',
    to: '',
    specs: ['tests/e2e/continuity-edge-cases.spec.mjs'],
    grep: 'midnight updates'
  },
  {
    name: 'unsupported calendar dates remain interactive',
    from: 'button.disabled = !parseDateValue(value);',
    to: '',
    specs: ['tests/e2e/continuity-edge-cases.spec.mjs'],
    grep: 'unsupported year'
  },
  {
    name: 'remote updates detach the active column input',
    from: 'const preservedColumn = preservedInput?.matches(".column-title") ? preservedInput.closest(".column") : null;',
    to: 'const preservedColumn = null;',
    specs: ['tests/e2e/continuity-edge-cases.spec.mjs'],
    grep: 'native undo for column title'
  },
  {
    name: 'remote updates detach the active checklist input',
    from: 'const preservedRow = preservedInput && els.checklist.contains(preservedInput) ? preservedInput.closest(".check-row") : null;',
    to: 'const preservedRow = null;',
    specs: ['tests/e2e/continuity-edge-cases.spec.mjs'],
    grep: 'native undo for checklist'
  },
  {
    name: 'remote updates erase tag separator history',
    from: 'if (preservedInput !== els.noteTags) els.noteTags.value = note.tags.join(", ");',
    to: 'els.noteTags.value = note.tags.join(", ");',
    specs: ['tests/e2e/continuity-edge-cases.spec.mjs'],
    grep: 'tags including an unfinished separator'
  },
  {
    name: 'preserved column inputs update detached state',
    from: 'const currentColumn = findColumn(column.id);',
    to: 'const currentColumn = column;',
    specs: ['tests/e2e/continuity-edge-cases.spec.mjs'],
    grep: 'remote reorder preserves the column'
  },
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
    name: 'truthy checklist values are marked complete',
    from: 'done: item?.done === true',
    to: 'done: Boolean(item?.done)',
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
    from: '      if (searchTerms().length) {\n        const scrollTop = list.scrollTop;\n        const visibleCount = renderColumnNoteList(list, currentColumn);\n        count.textContent = `${visibleCount} / ${currentColumn.notes.length}`;\n        mountIcons(list);\n        list.scrollTop = scrollTop;\n      }',
    to: '      if (false) {\n        const scrollTop = list.scrollTop;\n        const visibleCount = renderColumnNoteList(list, currentColumn);\n        count.textContent = `${visibleCount} / ${currentColumn.notes.length}`;\n        mountIcons(list);\n        list.scrollTop = scrollTop;\n      }',
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
    name: 'stale storage revisions may overwrite committed edits',
    from: 'if (writing && current.revision !== storageRevision) return;',
    to: 'if (false) return;',
    specs: ['tests/e2e/internal-quality.spec.mjs']
  },
  {
    name: 'failed primary writes leave blocking reservations',
    from: 'if (!saved && reservation) {',
    to: 'if (false) {',
    specs: ['tests/e2e/storage-lifecycle.spec.mjs']
  },
  {
    name: 'obsolete file reads interrupt newer imports',
    from: 'const text = await file.text();\n      if (generation !== importGeneration) return;',
    to: 'const text = await file.text();',
    specs: ['tests/e2e/async-and-boundary.spec.mjs']
  },
  {
    name: 'Unicode search matches use expanded offsets',
    from: 'const starts = lower.length === value.length ? null : [];',
    to: 'const starts = null;',
    specs: ['tests/e2e/ten-rounds-quality.spec.mjs'],
    grep: 'round 2:'
  },
  {
    name: 'unchanged note interactions create edits',
    from: '    if (JSON.stringify(found.note) === previous) return;',
    to: '',
    specs: ['tests/e2e/ten-rounds-quality.spec.mjs'],
    grep: 'round 4:'
  },
  {
    name: 'focused search input keeps cleared query text',
    from: 'if (!searchInputComposing && els.searchInput.value !== searchQuery) {',
    to: 'if (!searchInputComposing && document.activeElement !== els.searchInput) {',
    specs: ['tests/e2e/ten-rounds-quality.spec.mjs'],
    grep: 'round 8:'
  },
  {
    name: 'deferred modal opening steals newer focus',
    from: 'if (document.activeElement === initialFocus && activeModal() === modal) focus();',
    to: 'if (activeModal() === modal) focus();',
    specs: ['tests/e2e/ten-rounds-quality.spec.mjs'],
    grep: 'round 10: delayed editor'
  },
  {
    name: 'same-position note drops create edits',
    from: '    if (found.column === targetColumn && insertIndex === found.index) return;',
    to: '',
    specs: ['tests/e2e/quality-followup-rounds.spec.mjs'],
    grep: 'followup round 1: dropping a note'
  },
  {
    name: 'lost pointer capture leaves note drag active',
    from: '    document.addEventListener("lostpointercapture", cancelPointerDrag);',
    to: '',
    specs: ['tests/e2e/quality-followup-rounds.spec.mjs'],
    grep: 'followup round 2: losing pointer capture cancels a note'
  },
  {
    name: 'ninth and subsequent search terms are ignored',
    from: '      .split(/\\s+/)\n      .filter(Boolean))];',
    to: '      .split(/\\s+/)\n      .filter(Boolean).slice(0, 8))];',
    specs: ['tests/e2e/quality-followup-rounds.spec.mjs'],
    grep: 'followup round 6:'
  },
  {
    name: 'remote rendering overwrites active search composition',
    from: 'if (!searchInputComposing && els.searchInput.value !== searchQuery) {',
    to: 'if (els.searchInput.value !== searchQuery) {',
    specs: ['tests/e2e/quality-followup-rounds.spec.mjs'],
    grep: 'followup round 7:'
  },
  {
    name: 'deferred actions overwrite a newer focus choice',
    from: 'if (generation !== deferredFocusGeneration || document.activeElement !== initialFocus || activeModal() !== modal) return;',
    to: 'if (generation !== deferredFocusGeneration || activeModal() !== modal) return;',
    specs: ['tests/e2e/quality-followup-rounds.spec.mjs'],
    grep: 'followup round 10:'
  },
  {
    name: 'recovery writes despite failed startup lock acquisition',
    from: 'const backedUp = allowRecoveryBackup && backupCorruptStoredState(stored);',
    to: 'const backedUp = Boolean(navigator.locks) && backupCorruptStoredState(stored);',
    specs: ['tests/e2e/unlocked-recovery.spec.mjs'],
    grep: 'startup locking is denied'
  },
  {
    name: 'text limits interrupt active IME conversion',
    from: 'if (!composingTextInputs.has(input) && input.value.length > limit) {',
    to: 'if (input.value.length > limit) {',
    specs: ['tests/e2e/input-and-view-continuity.spec.mjs'],
    grep: 'IME keeps the over-limit note title'
  },
  {
    name: 'unrelated synchronization erases unfinished input',
    from: 'const editingInput = captureEditingInput();',
    to: 'const editingInput = null;',
    specs: ['tests/e2e/input-and-view-continuity.spec.mjs'],
    grep: 'unfinished tag separator'
  },
  {
    name: 'board actions discard column reading positions',
    from: 'function renderBoard(preserveScroll = true, preservedInput = null) {',
    to: 'function renderBoard(preserveScroll = false, preservedInput = null) {',
    specs: ['tests/e2e/input-and-view-continuity.spec.mjs'],
    grep: 'reading position after move-note'
  },
  {
    name: 'newly opened notes inherit the previous checklist scroll',
    from: '      els.checklist.scrollTop = 0;',
    to: '',
    specs: ['tests/e2e/input-and-view-continuity.spec.mjs'],
    grep: 'newly opened note'
  },
  {
    name: 'hidden editors reset scroll before they have a layout box',
    from: '    delete els.drawer.dataset.closing;\n    els.drawer.hidden = false;\n    if (switchingNote) {\n      // display:noneの要素にはスクロール領域がない。表示してから位置を初期化し、\n      // 前に開いた付箋のスクロール位置がブラウザーによって復元されるのを防ぐ。\n      els.drawerBody.scrollTop = 0;\n      els.checklist.scrollTop = 0;\n      els.noteBody.scrollTop = 0;\n      els.noteBody.scrollLeft = 0;\n    }',
    to: '    if (switchingNote) {\n      els.drawerBody.scrollTop = 0;\n      els.checklist.scrollTop = 0;\n      els.noteBody.scrollTop = 0;\n      els.noteBody.scrollLeft = 0;\n    }\n    delete els.drawer.dataset.closing;\n    els.drawer.hidden = false;',
    specs: ['tests/e2e/interaction-continuity.spec.mjs'],
    grep: 'fully hidden editor'
  },
  {
    name: 'frequent body matches create unbounded highlight nodes',
    from: 'appendHighlightedText(body, note.body, 128);',
    to: 'appendHighlightedText(body, note.body);',
    specs: ['tests/e2e/input-and-view-continuity.spec.mjs'],
    grep: 'frequent body matches'
  },
  {
    name: 'startup accepts edits before loading storage',
    from: 'els.appShell.inert = !storageReady || Boolean(active);',
    to: 'els.appShell.inert = Boolean(active);',
    specs: ['tests/e2e/interaction-continuity.spec.mjs'],
    grep: 'delayed storage load'
  },
  {
    name: 'overlapping search matches lose their trailing highlight',
    from: 'if (match.index === matchIndex) match.index = lower.indexOf(match.term, matchIndex + 1);',
    to: 'if (match.index === matchIndex) match.index = lower.indexOf(match.term, lowerEnd);',
    specs: ['tests/e2e/interaction-continuity.spec.mjs'],
    grep: 'full union for aba bab'
  },
  {
    name: 'cancelled tag conversion rewrites imported values',
    from: 'if (els.noteTags.value === lastValidTagsInput) {',
    to: 'if (false) {',
    specs: ['tests/e2e/interaction-continuity.spec.mjs'],
    grep: 'cancelling an IME conversion'
  },
  {
    name: 'filtered editing loses the reading position',
    from: '      list.scrollTop = scrollTop;\n    } else {\n      renderBoard();',
    to: '    } else {\n      renderBoard();',
    specs: ['tests/e2e/quiet-quality.spec.mjs'],
    grep: 'leave and rejoin results'
  },
  {
    name: 'unchanged search events rebuild results',
    from: 'if (previousTerms.length !== nextTerms.length || nextTerms.some((term) => !previousTerms.includes(term))) {',
    to: 'if (true) {',
    specs: ['tests/e2e/quiet-quality.spec.mjs'],
    grep: 'result scroll again'
  },
  {
    name: 'calendar keyboard selection ignores direct focus',
    from: 'calendarFocusedDate = day;',
    to: '',
    specs: ['tests/e2e/quiet-quality.spec.mjs'],
    grep: 'the date actually focused'
  },
  {
    name: 'deferred remote updates never resume',
    from: 'if (!storageSyncDeferred) return;',
    to: 'return;',
    specs: ['tests/e2e/quiet-quality.spec.mjs'],
    grep: 'cancelling a confirmation'
  },
  {
    name: 'column drops outside the workspace still reorder',
    from: 'if (!document.elementFromPoint(x, y)?.closest(".board-shell")) {',
    to: 'if (false) {',
    specs: ['tests/e2e/interaction-continuity.spec.mjs'],
    grep: 'outside the board'
  },
  {
    name: 'dragging at the edge never scrolls',
    from: 'if (dragScrollFrame === null) dragScrollFrame = requestAnimationFrame(scrollDuringDrag);',
    to: '',
    specs: ['tests/e2e/drag-scroll.spec.mjs'],
    grep: 'a note can be dragged'
  },
  {
    name: 'equal frame timestamps strand an active drag',
    from: 'Math.min(32, Math.max(1, time - dragScrollTime))',
    to: 'Math.min(32, time - dragScrollTime)',
    specs: ['tests/e2e/drag-scroll.spec.mjs'],
    grep: 'equal animation timestamps'
  },
  {
    name: 'short viewport date popover can overflow',
    from: 'max-height: calc(100dvh - 20px);\n  gap: 10px;\n  overflow: auto;',
    to: 'gap: 10px;',
    specs: ['tests/e2e/responsive.spec.mjs']
  }
];

function runSuite(specs, html, label, grep) {
  const run = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['playwright', 'test', ...specs, ...(grep ? ['--grep', grep] : []), '--project=chromium', '--workers=2', '--reporter=json',
      `--output=${path.join(mutationDir, 'results', label)}`],
    {
      encoding: 'utf8',
      env: { ...process.env, PETA_TEST_BROWSERS: 'chromium', PETA_BOARD_HTML: html },
      stdio: 'pipe',
      timeout: 180000,
      maxBuffer: 32 * 1024 * 1024
    }
  );
  let report;
  try { report = JSON.parse(run.stdout); } catch { /* レポートの読み取り失敗は、不具合の検出として数えない。 */ }
  const invalid = run.error || run.signal || !report?.stats
    || report.errors?.length
    || !(report.stats.expected + report.stats.unexpected)
    || /browserType\.launch|Executable doesn't exist|Failed to launch|No tests found/.test(run.stdout || '');
  return {
    status: invalid ? 'error' : run.status === 0 && report.stats.unexpected === 0 ? 'passed' : 'failed',
    exitCode: run.status,
    passed: report?.stats?.expected || 0,
    failed: report?.stats?.unexpected || 0,
    output: `${run.error || ''}\n${run.stdout || ''}\n${run.stderr || ''}`.slice(-4000)
  };
}

const baselineSpecs = [...new Set(mutants.flatMap((mutant) => mutant.specs || ['tests/unit']))];
const baseline = runSuite(baselineSpecs, appPath, 'baseline');
if (baseline.status !== 'passed') {
  fs.writeFileSync(path.join(reportsDir, 'mutation-summary.json'), JSON.stringify({
    sha256: sourceHash, mutationScore: null, baseline, results: [], reason: 'The unmodified baseline must pass before mutation testing.'
  }, null, 2));
  console.error('Mutation checks aborted: the unmodified baseline did not pass.');
  process.exit(1);
}
console.log(`Baseline: ${baseline.passed} passed`);

const results = [];
for (const [index, mutant] of mutants.entries()) {
  if (source.split(mutant.from).length !== 2) {
    results.push({ name: mutant.name, status: 'not-run', reason: 'Mutation target must match exactly once.' });
    continue;
  }
  const mutantHtml = path.join(mutationDir, `${mutant.name.replace(/[^A-Za-z0-9_-]+/g, '-')}.html`);
  fs.writeFileSync(mutantHtml, source.replace(mutant.from, mutant.to));
  const run = runSuite(mutant.specs || ['tests/unit'], mutantHtml, `mutant-${index}`, mutant.grep);
  const status = run.status === 'error' ? 'error' : run.status === 'failed' ? 'killed' : 'survived';
  results.push({ ...run, name: mutant.name, status });
  console.log(`${status.toUpperCase()}: ${mutant.name}`);
}

const killed = results.filter((result) => result.status === 'killed').length;
const runCount = results.filter((result) => result.status === 'killed' || result.status === 'survived').length;
const summary = {
  sha256: sourceHash,
  baseline: { passed: baseline.passed, failed: baseline.failed },
  errors: results.filter((result) => result.status === 'error').length,
  target: 'Targeted mutation checks for ID and date validation, storage revision conflicts and failure recovery, obsolete imports, IME handling, focus, search and popover containment',
  mutationScore: runCount ? Number((killed / runCount * 100).toFixed(1)) : 0,
  killed,
  survived: results.filter((result) => result.status === 'survived').length,
  notRun: results.filter((result) => result.status === 'not-run').length,
  results
};

fs.writeFileSync(path.join(reportsDir, 'mutation-summary.json'), JSON.stringify(summary, null, 2));
console.log(`Mutation score: ${summary.mutationScore}% (${killed}/${runCount} killed)`);
process.exit(summary.survived > 0 || summary.notRun > 0 || summary.errors > 0 ? 1 : 0);
