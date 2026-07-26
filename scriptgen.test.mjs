// scriptgen.test.mjs — PowerShell 导出脚本测试（node scriptgen.test.mjs）
import assert from 'node:assert/strict';
import { buildPowerShellScript } from './scriptgen.js';
import { computeRenames } from './engine.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; }
}

const tmpFn = i => 'T' + i; // 决定性临时名，便于测试

// 便捷封装：用引擎真实计算一批文件的改名结果
function compute(files, orig, edit, options = {}) {
  return computeRenames({ files, templateOriginal: orig, templateEdited: edit, options, rng: () => 0 });
}

console.log('buildPowerShellScript — 解析校验');
test('归档到子目录：生成 New-Item + 两阶段 Move-Item', () => {
  const files = [{ name: 'a.jpg', dirParts: [] }, { name: 'b.jpg', dirParts: [] }];
  const res = compute(files, 'a.jpg', 'Photos/<n>.jpg');
  const script = buildPowerShellScript(res, 'Album', { tmpFn });
  assert.ok(script.includes('New-Item -ItemType Directory -Force -Path ' + "'Photos'"), '应创建 Photos 子目录');
  const moveCount = (script.match(/Move-Item -LiteralPath/g) || []).length;
  assert.equal(moveCount, 4, '应为 2 文件 × 2 阶段 = 4 条 Move-Item');
  assert.ok(script.includes("Move-Item -LiteralPath 'a.jpg' -Destination 'Photos\\T0'"), '阶段一临时名放在目标子目录内');
  assert.ok(script.includes("Move-Item -LiteralPath 'Photos\\T0' -Destination 'Photos\\1.jpg'"), '阶段二目标进入 Photos');
});

test('用户真实场景：平屋慢生活.E01 各文件递增', () => {
  const files = [];
  for (let i = 1; i <= 7; i++) files.push({ name: String(i).padStart(2, '0') + '.mp4', dirParts: [] });
  const res = compute(files, '01.mp4', '平屋慢生活.E01.mp4');
  const script = buildPowerShellScript(res, 'Videos', { tmpFn });
  assert.ok(script.includes("Move-Item -LiteralPath 'T6' -Destination '平屋慢生活.E07.mp4'"), '第 7 个应到 E07');
  assert.ok(!script.includes('New-Item'), '无归档不应生成 New-Item');
});

test('循环改名 a->b->c->a：两阶段脚本可安全还原', () => {
  const results = [
    { file: { name: 'a.txt', dirParts: [] }, renamed: 'b.txt' },
    { file: { name: 'b.txt', dirParts: [] }, renamed: 'c.txt' },
    { file: { name: 'c.txt', dirParts: [] }, renamed: 'a.txt' },
  ];
  const script = buildPowerShellScript(results, 'X', { tmpFn });
  // 安全性：阶段一的临时名应唯一，且不与任何原始文件名相同（避免覆盖未移动的文件）
  const phase1 = script.split('# ---- 阶段二')[0];
  const tmpDests = [...phase1.matchAll(/Destination '([^']+)'/g)].map(m => m[1]);
  assert.equal(new Set(tmpDests).size, tmpDests.length, '临时名应唯一');
  assert.ok(!tmpDests.includes('a.txt') && !tmpDests.includes('b.txt') && !tmpDests.includes('c.txt'), '临时名不应是原始文件名');
});

test('路径含空格与单引号：PowerShell 单引号转义正确', () => {
  const results = [{ file: { name: "O'Brien.jpg", dirParts: [] }, renamed: "O'Brien v2.jpg" }];
  const script = buildPowerShellScript(results, 'X', { tmpFn });
  assert.ok(script.includes("'O''Brien.jpg'"), '单引号应被转义为两个单引号');
  assert.ok(script.includes("'O''Brien v2.jpg'"), '新名中的单引号也转义');
});

console.log('buildPowerShellScript — 真实执行（若环境有 PowerShell）');
function havePowerShell() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', '"ok"'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}
test('在临时目录真实运行脚本，改名结果正确', function () {
  if (!havePowerShell()) { console.log('    （跳过：无 powershell）'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'renamerx-'));
  try {
    const files = [];
    for (let i = 1; i <= 5; i++) {
      const name = 'f' + i + '.dat';
      files.push({ name, dirParts: [] });
      writeFileSync(join(dir, name), 'x'); // 真实创建源文件
    }
    // 让 1->A 2->B 3->C 4->D 5->E（无冲突的排列）
    const renames = ['A.dat', 'B.dat', 'C.dat', 'D.dat', 'E.dat'];
    const results = files.map((f, i) => ({ file: f, renamed: renames[i] }));
    const script = buildPowerShellScript(results, 'tmp', { tmpFn });
    writeFileSync(join(dir, 'renamerx-export.ps1'), script);
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(dir, 'renamerx-export.ps1')], { cwd: dir, stdio: 'pipe' });
    } catch (e) {
      console.error('  PowerShell stderr:', e.stderr ? e.stderr.toString() : '', '\n  stdout:', e.stdout ? e.stdout.toString() : '');
      throw e;
    }
    const after = readdirSync(dir).filter(n => n.endsWith('.dat')).sort();
    assert.deepEqual(after, ['A.dat', 'B.dat', 'C.dat', 'D.dat', 'E.dat']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n通过 ${passed} 项测试` + (process.exitCode ? '（存在失败）' : '，全部通过 ✅'));
