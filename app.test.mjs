// app.test.mjs — 用最小 DOM 模拟把真实 app.js 端到端跑起来（node app.test.mjs）
// 覆盖：兼容模式加载 + 预览、File System Access 真实改名
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// 最小 DOM / 浏览器环境模拟
// ---------------------------------------------------------------------------
class El {
  constructor(id) {
    this.id = id; this._l = {};
    this.value = ''; this.checked = false; this.hidden = false; this.disabled = false;
    this.textContent = ''; this.className = ''; this.href = ''; this.innerHTML = ''; this.files = null;
  }
  addEventListener(t, f) { (this._l[t] ||= []).push(f); }
  removeEventListener() {}
  click() {}
  focus() {}
  appendChild() {}
  remove() {}
  _fire(t, e = {}) { (this._l[t] || []).forEach(f => f(e)); }
}
const elements = {};
const document = {
  getElementById(id) { return elements[id] ||= new El(id); },
  createElement() { return new El('a'); },
  querySelectorAll(sel) {
    if (sel === '#busuanzi_value_site_uv') {
      const el = this.getElementById('busuanzi_value_site_uv');
      return [el];
    }
    return [];
  },
  body: { appendChild() {} },
};
const win = {
  _l: {}, isSecureContext: true, showDirectoryPicker: null,
  addEventListener(t, f) { (this._l[t] ||= []).push(f); },
};
const location = { protocol: 'https:' };
let lastBlob = null;
const URLmock = {
  createObjectURL: (b) => { lastBlob = b; return 'blob:x'; },
  revokeObjectURL() {},
};

globalThis.document = document;
globalThis.window = win;
globalThis.location = location;
globalThis.URL = URLmock;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let passed = 0;
function test(name, fn) {
  const run = async () => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; } };
  return run();
}

await import('./app.js');

// 辅助：构造 fake 文件
function fakeFiles(prefix, n) {
  const arr = [];
  for (let i = 1; i <= n; i++) {
    const name = String(i).padStart(2, '0') + '.' + (prefix === 'vid' ? 'mp4' : 'dat');
    arr.push({ name, webkitRelativePath: 'Root/' + name, lastModified: 0, size: 0 });
  }
  return arr;
}

console.log('app.js 端到端');
await test('兼容模式加载 + 预览 E01..E07', async () => {
  const dir = elements['dirInput'];
  dir.files = fakeFiles('vid', 7);
  dir._fire('change');                       // 触发 loadFromCompat
  elements['templateInput'].value = '平屋慢生活.E01.mp4';
  elements['templateInput']._fire('input');  // 触发防抖渲染
  await sleep(200);
  const html = elements['previewBody'].innerHTML;
  assert.ok(html.includes('平屋慢生活.E07.mp4'), '预览应包含 E07');
  assert.ok(elements['applyBtn'].hidden === true, '兼容模式应隐藏直接改名按钮');
});

await test('File System Access：真实改名', async () => {
  // 准备一个 fake 文件夹（3 个文件，支持 move / getDirectoryHandle）
  const mkFile = (name) => ({ kind: 'file', name, getFile: async () => ({ lastModified: 0, size: 0 }), move: async () => {} });
  const entries = [mkFile('01.dat'), mkFile('02.dat'), mkFile('03.dat')];
  const root = {
    kind: 'directory', name: 'root',
    values: async function* () { for (const e of entries) yield e; },
    getDirectoryHandle: async () => ({ kind: 'directory', getFile: async () => ({ lastModified: 0, size: 0 }), move: async () => {} }),
  };
  win.isSecureContext = true;
  win.showDirectoryPicker = async () => root;

  elements['pickBtn']._fire('click');         // loadFromHandle(root, false)
  await sleep(50);
  elements['templateInput'].value = '系列.<n>.dat';
  elements['templateInput']._fire('input');
  await sleep(200);
  assert.ok(elements['previewBody'].innerHTML.includes('系列.3.dat'), '预览应含 系列.3.dat');

  elements['applyBtn']._fire('click');        // applyRenames
  await sleep(50);
  const afterHtml = elements['previewBody'].innerHTML;
  assert.ok(afterHtml.includes('系列.1.dat') && afterHtml.includes('系列.3.dat'), '应用后预览应为新名');
});

await test('file:// 下「选择文件夹」按钮应提示而非崩溃', async () => {
  location.protocol = 'file:';
  win.isSecureContext = false;
  win.showDirectoryPicker = undefined;
  elements['pickBtn']._fire('click');
  await sleep(20);
  assert.ok(elements['banner'].hidden === false, 'file:// 应显示横幅');
  assert.ok(/兼容模式|file/.test(elements['status'].textContent), '应提示使用兼容模式');
  location.protocol = 'https:';
});

await test('点「一键插入标签」把 <n> 插入模板输入框', async () => {
  elements['templateInput'].value = '照片_';
  const fakeEvent = { target: { closest: () => ({ getAttribute: () => '<n>' }) } };
  elements['tagPalette']._fire('click', fakeEvent);
  await sleep(10);
  assert.ok(elements['templateInput'].value === '照片_<n>', '应插入为 照片_<n>，实际=' + elements['templateInput'].value);
});

console.log(`\n通过 ${passed} 项测试` + (process.exitCode ? '（存在失败）' : '，全部通过 ✅'));
