// engine.test.mjs — 引擎单元测试（node engine.test.mjs）
import assert from 'node:assert/strict';
import { tokenize, applyToTarget, computeRenames, evaluateTag, resolveTargetPath } from './engine.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; }
}

// 固定 rng，保证随机标签可测：始终返回字符集第 0 个字符
const rng0 = () => 0;

console.log('tokenize');
test('分词：单词/分隔符/标签', () => {
  const t = tokenize('Plan Report 2023.txt', true);
  assert.deepEqual(t.map(x => x.kind), ['word', 'sep', 'word', 'sep', 'word', 'sep', 'word']);
  const tg = tokenize('IMG_<n>_final', true);
  assert.equal(tg.find(x => x.kind === 'tag').inner, 'n');
});

console.log('applyToTarget — 变换传播');
test('前缀截断传播：Plan Report 2023 -> P R 2023 套用到 Budget Summary 2024 = B S 2024', () => {
  const O = tokenize('Plan Report 2023', false);
  const E = tokenize('P R 2023', true);
  const T = tokenize('Budget Summary 2024', false);
  assert.equal(applyToTarget(O, E, T, { index: 1, total: 2, dirParts: [] }), 'B S 2024');
});
test('后缀截断传播：FileBackup -> Backup 套用到 DataBackup = Backup', () => {
  const O = tokenize('FileBackup', false);
  const E = tokenize('Backup', true);
  const T = tokenize('DataBackup', false);
  assert.equal(applyToTarget(O, E, T, { index: 1, total: 2, dirParts: [] }), 'Backup');
});
test('大小写变换：plan -> Plan 套用到 report = Report（首字母大写）', () => {
  const O = tokenize('plan', false);
  const E = tokenize('Plan', true);
  const T = tokenize('report', false);
  assert.equal(applyToTarget(O, E, T, { index: 1, total: 2, dirParts: [] }), 'Report');
});
test('插入字面量：Plan -> X Plan 套用到 Report = X Report', () => {
  const O = tokenize('Plan', false);
  const E = tokenize('X Plan', true);
  const T = tokenize('Report', false);
  assert.equal(applyToTarget(O, E, T, { index: 1, total: 2, dirParts: [] }), 'X Report');
});
test('删除：Plan Report -> Plan 套用到 Foo Bar = Foo', () => {
  const O = tokenize('Plan Report', false);
  const E = tokenize('Plan', true);
  const T = tokenize('Foo Bar', false);
  assert.equal(applyToTarget(O, E, T, { index: 1, total: 2, dirParts: [] }), 'Foo');
});

console.log('标签求值');
test('<abc> 原样输出 abc', () => assert.equal(evaluateTag('abc', {}, rng0), 'abc'));
test('<P> 原样输出 P', () => assert.equal(evaluateTag('P', {}, rng0), 'P'));
test('<n> 12 个文件 -> 补零到 2 位', () => {
  for (let i = 1; i <= 12; i++) {
    const s = evaluateTag('n', { index: i, total: 12 }, rng0);
    assert.equal(s.length, 2);
    assert.equal(s, String(i).padStart(2, '0'));
  }
});
test('<n,5> 10 个文件从第 5 开始 -> 05..14', () => {
  assert.equal(evaluateTag('n,5', { index: 1, total: 10 }, rng0), '05');
  assert.equal(evaluateTag('n,5', { index: 10, total: 10 }, rng0), '14');
});
test('<dir> / <dir,2> 取父目录', () => {
  const ctx = { dirParts: ['Photos', '2023'] };
  assert.equal(evaluateTag('dir', ctx, rng0), '2023');
  assert.equal(evaluateTag('dir,2', ctx, rng0), 'Photos');
  assert.equal(evaluateTag('dir,9', ctx, rng0), '');
});
test('随机标签（rng0 恒取首字符）', () => {
  assert.equal(evaluateTag('r', {}, rng0), '000000');
  assert.equal(evaluateTag('r,4', {}, rng0), '0000');
  assert.equal(evaluateTag('rl,3', {}, rng0), 'aaa');
  assert.equal(evaluateTag('ru,3', {}, rng0), 'AAA');
  assert.equal(evaluateTag('ra,3', {}, rng0), 'aaa');
  assert.equal(evaluateTag('rA,3', {}, rng0), 'AAA');
  assert.equal(evaluateTag('rXYZ,3', {}, rng0), 'XXX');
});

console.log('computeRenames — 端到端');
test('编号跟随排序：按名称排序后 <n> 依次递增', () => {
  const files = [
    { name: 'banana.txt', dirParts: ['d'] },
    { name: 'apple.txt', dirParts: ['d'] },
    { name: 'cherry.txt', dirParts: ['d'] },
  ];
  // 排序后顺序：apple, banana, cherry；模板只留 <n>，扩展名被模板接管
  const res = computeRenames({ files, templateOriginal: 'apple.txt', templateEdited: '<n>', options: { sort: 'name' }, rng: rng0 });
  assert.deepEqual(res.map(r => r.renamed), ['1', '2', '3']);
});
test('<apple> 原样标签可固定文本（不随各文件变化）', () => {
  const files = [
    { name: 'banana.txt', dirParts: ['d'] },
    { name: 'apple.txt', dirParts: ['d'] },
    { name: 'cherry.txt', dirParts: ['d'] },
  ];
  const res = computeRenames({ files, templateOriginal: 'apple.txt', templateEdited: '<n>_<apple>.txt', options: { sort: 'name' }, rng: rng0 });
  assert.deepEqual(res.map(r => r.renamed), ['1_apple.txt', '2_apple.txt', '3_apple.txt']);
});
test('归档到子目录：Photos/<n>', () => {
  const files = [{ name: 'a.jpg', dirParts: ['d'] }, { name: 'b.jpg', dirParts: ['d'] }];
  const res = computeRenames({ files, templateOriginal: 'a.jpg', templateEdited: 'Photos/<n>.jpg', options: {}, rng: rng0 });
  assert.ok(res[0].renamed.startsWith('Photos/'));
  assert.equal(res[0].relativeKey, 'd/Photos/1.jpg');
});
test('父目录标签 + 前缀截断组合', () => {
  const files = [{ name: 'Vacation_01.jpg', dirParts: ['Photos', '2023'] }];
  const res = computeRenames({ files, templateOriginal: 'Vacation_01.jpg', templateEdited: '<dir>_<n>.jpg', options: {}, rng: rng0 });
  assert.equal(res[0].renamed, '2023_1.jpg');
});
test('目标路径冲突检测', () => {
  const files = [{ name: 'a.jpg', dirParts: ['d'] }, { name: 'b.jpg', dirParts: ['d'] }];
  const res = computeRenames({ files, templateOriginal: 'a.jpg', templateEdited: 'same.jpg', options: {}, rng: rng0 });
  assert.equal(res[0].warnings.some(w => w.includes('冲突')), true);
});
test('Windows 非法字符检测', () => {
  const files = [{ name: 'a.txt', dirParts: ['d'] }];
  const res = computeRenames({ files, templateOriginal: 'a.txt', templateEdited: 'a:b.txt', options: {}, rng: rng0 });
  assert.equal(res[0].warnings.some(w => w.includes('非法')), true);
});

console.log('resolveTargetPath — 子目录归档 / 上移');
test('无分隔符：仅改名', () => {
  assert.deepEqual(resolveTargetPath({ dirParts: ['A', 'B'] }, 'x.jpg'), { parent: ['A', 'B'], base: 'x.jpg' });
});
test('归档到子目录 Photos/<n>', () => {
  assert.deepEqual(resolveTargetPath({ dirParts: ['A', 'B'] }, 'Photos/001.jpg'), { parent: ['A', 'B', 'Photos'], base: '001.jpg' });
});
test('上移一级 ../x', () => {
  assert.deepEqual(resolveTargetPath({ dirParts: ['A', 'B'] }, '../x.jpg'), { parent: ['A'], base: 'x.jpg' });
});
test('反斜杠同样生效', () => {
  assert.deepEqual(resolveTargetPath({ dirParts: ['A'] }, 'Sub\\y.png'), { parent: ['A', 'Sub'], base: 'y.png' });
});

console.log(`\n通过 ${passed} 项测试` + (process.exitCode ? '（存在失败）' : '，全部通过 ✅'));
