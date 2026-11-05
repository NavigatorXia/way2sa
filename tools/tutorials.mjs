#!/usr/bin/env node
/**
 * Way2SA tutorial experiment runner (zero dependencies).
 *
 *   node tools/tutorials.mjs
 *
 * Extracts every ```js fenced block from the 8 TUTORIAL.md files and runs it
 * in a fresh sandbox. console.assert throws on failure, so a wrong experiment
 * result fails the run instead of printing silently.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LESSONS = path.join(ROOT, 'lessons');
const dirs = fs.readdirSync(LESSONS).filter(d => /^L0\d-/.test(d)).sort();
const failures = [];
let total = 0;

for (const dir of dirs) {
  const file = path.join(LESSONS, dir, 'TUTORIAL.md');
  if (!fs.existsSync(file)) { failures.push(`${dir}: TUTORIAL.md missing`); continue; }
  const text = fs.readFileSync(file, 'utf8');
  const blocks = [...text.matchAll(/```js\n([\s\S]*?)```/g)].map(m => m[1]);
  if (blocks.length < 2) failures.push(`${dir}: expected >= 2 runnable JS experiments, got ${blocks.length}`);

  for (const [i, code] of blocks.entries()) {
    total++;
    const logs = [];
    const sandbox = {
      Math, JSON, Date, Map, Set, Promise, setTimeout, clearTimeout,
      console: {
        log: (...a) => logs.push(a.map(String).join(' ')),
        assert: (cond, msg) => { if (!cond) throw new Error(`console.assert failed: ${msg || '(no message)'}`); },
        warn: () => {}, error: (...a) => { throw new Error('console.error: ' + a.join(' ')); }
      }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    try {
      vm.runInContext(code, sandbox, { filename: `${dir}/TUTORIAL.md#js-${i + 1}`, timeout: 3000 });
    } catch (e) {
      failures.push(`${dir} experiment ${i + 1}: ${e.message}`);
      continue;
    }
    // Async experiments (e.g. `await reload()`) log from microtasks.
    await new Promise(resolve => setImmediate(resolve));
    if (!/console\.(log|assert)/.test(code)) {
      failures.push(`${dir} experiment ${i + 1}: has no observable output/assertion`);
    }
    if (!logs.length && !/console\.assert/.test(code)) {
      failures.push(`${dir} experiment ${i + 1}: produced no output`);
    }
  }
  console.log(`  ${dir} ✓ ${blocks.length} experiments`);
}

console.log('Way2SA tutorial experiments');
console.log('─'.repeat(56));
if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  for (const f of failures) console.log('  x ' + f);
  process.exit(1);
}
console.log(`\nOK: ${total} runnable experiments across ${dirs.length} tutorials executed without errors or failed assertions.`);
