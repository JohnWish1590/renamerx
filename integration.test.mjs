// integration.test.mjs — 用内存版文件系统句柄，验证「应用重命名 + 撤销」整条链路
// 模拟浏览器 File System Access API 的关键行为：values() / getDirectoryHandle / move
import assert from 'node:assert/strict';
import { computeRenames, resolveTargetPath } from './engine.js';

// ---- 极简内存文件系统 ----
function makeTree() {
  const root = { type: 'dir', name: '(root)', children: new Map(), parent: null };
  function dir(name, parent) {
    const d = { type: 'dir', name, children: new Map(), parent };
    parent.children.set(name, d); return d;
  }
  function file(name, parent) {
    const f = { type: 'file', name, parent, children: new Map() };
    parent.children.set(name, f); return f;
  }
  // 结构：root/dirA/{a.txt, b.txt}
  const dirA = dir('dirA', root);
  file('a.txt', dirA); file('b.txt', dirA);
  return { root, dirA };
}
function values(handle) {
  async function* gen() { for (const c of handle.children.values()) yield c; }
  return gen();
}
async function resolveParent(rootHandle, parts) {
  let h = rootHandle;
  for (const p of parts) {
    if (!h.children.has(p)) h.children.set(p, { type: 'dir', name: p, children: new Map(), parent: h });
    h = h.children.get(p);
  }
  return h;
}
async function applyAndUndo(tree, templateOriginal, templateEdited) {
  const { root } = tree;
  // 收集文件
  const files = [];
  for await (const e of values(root.children.get('dirA'))) {
    if (e.type === 'file') files.push({ handle: e, name: e.name, dirParts: ['dirA'] });
  }
  const res = computeRenames({ files, templateOriginal, templateEdited, options: { sort: 'name' } });
  const undoList = [];
  for (let i = 0; i < res.length; i++) {
    const r = res[i], f = files[i];
    const { parent, base } = resolveTargetPath(f, r.renamed);
    const parentHandle = await resolveParent(root, parent);
    // move：从旧父移除，加入新父
    f.handle.parent.children.delete(f.handle.name);
    f.handle.name = base; f.handle.parent = parentHandle;
    parentHandle.children.set(base, f.handle);
    undoList.push({ handle: f.handle, origName: f.name, origDirParts: f.dirParts.slice() });
  }
  // 断言：重命名结果（撤销前快照）
  const names = [...root.children.get('dirA').children.values()].map(c => c.name).sort();
  const photos = root.children.get('dirA').children.get('Photos');
  const appliedPhotos = photos ? [...photos.children.values()].map(c => c.name).sort() : null;
  // 撤销
  for (const u of undoList) {
    const parentHandle = await resolveParent(root, u.origDirParts);
    u.handle.parent.children.delete(u.handle.name);
    u.handle.name = u.origName; u.handle.parent = parentHandle;
    parentHandle.children.set(u.origName, u.handle);
  }
  const restored = [...root.children.get('dirA').children.values()].map(c => c.name).sort();
  return { names, appliedPhotos, restored };
}

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; }
}

console.log('integration — 应用 + 撤销');
test('基础改名后可撤销还原', async () => {
  const tree = makeTree();
  const { names, restored } = await applyAndUndo(tree, 'a.txt', 'x_<n>.txt');
  assert.deepEqual(names, ['x_1.txt', 'x_2.txt']);
  assert.deepEqual(restored, ['a.txt', 'b.txt']);
});
test('归档到子目录 Photos/ 后撤销还原', async () => {
  const tree = makeTree();
  const { names, appliedPhotos, restored } = await applyAndUndo(tree, 'a.txt', 'Photos/<n>.jpg');
  // 原 dirA 下只剩 Photos 子目录，文件已移入其中
  assert.deepEqual(names, ['Photos']);
  assert.deepEqual(appliedPhotos, ['1.jpg', '2.jpg']);
  // 撤销后两个文件已还原（Photos 空目录可能保留，属正常）
  assert.ok(restored.includes('a.txt') && restored.includes('b.txt'));
});

console.log(`\n集成测试通过 ${passed} 项` + (process.exitCode ? '（存在失败）' : ' ✅'));
