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
  createTextNode(t) { return { textContent: t, nodeType: 3 }; },
  querySelectorAll(sel) {
    if (sel === '#busuanzi_value_site_uv') {
      const el = this.getElementById('busuanzi_value_site_uv');
      return [el];
    }
    return [];
  },
  addEventListener() {},
  removeEventListener() {},
  body: { appendChild() {} },
};
const win = {
  _l: {}, isSecureContext: true, showDirectoryPicker: null,
  addEventListener(t, f) { (this._l[t] ||= []).push(f); },
};
const location = { protocol: 'https:' };
let lastBlob = null;
// 注意：不要整体替换 globalThis.URL。
// app.js 仅可能用到 URL.createObjectURL / revokeObjectURL；
// 若把 URL 换成一个普通对象，在带 broker FS shim 的 node 下
// `instanceof URL` 会因右侧不再是可调用类而崩溃，导致模块加载失败。
// 这里只给真实的 URL 类补两个静态方法，既满足 app.js 又能保住 instanceof 语义。
globalThis.URL.createObjectURL = (b) => { lastBlob = b; return 'blob:x'; };
globalThis.URL.revokeObjectURL = () => {};

globalThis.document = document;
globalThis.window = win;
globalThis.location = location;

// fetch mock：模拟自建计数后端 /api/count（测试不联网）
//   GET  → { count }          读全网真实总数
//   POST → { count }          上报 +N 并返回累加后的真值
//   force429 = true 时模拟被限流：HTTP 429，但仍返回真值（前端不应跳变）
const countServer = { value: 123, force429: false, posts: [] };
globalThis.__countServer = countServer;
globalThis.fetch = async (url, opt) => {
  if (typeof url === 'string' && url.includes('/api/count')) {
    if (opt && opt.method === 'POST') {
      const body = JSON.parse(opt.body || '{}');
      countServer.posts.push(body.n);
      if (!countServer.force429) countServer.value += body.n;
    }
    return {
      ok: !countServer.force429,
      status: countServer.force429 ? 429 : 200,
      json: async () => ({ count: countServer.value }),
    };
  }
  return { ok: false, json: async () => ({}) };
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let passed = 0;
function test(name, fn) {
  const run = async () => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n    ', e.message); process.exitCode = 1; } };
  return run();
}

await import('./app.js');

// 辅助：搭一个支持 File System Access 的 fake 文件夹（n 个 01.dat…）
function fakeDir(n) {
  const mkFile = (name) => ({ kind: 'file', name, getFile: async () => ({ lastModified: 0, size: 0 }), move: async () => {} });
  const entries = [];
  for (let i = 1; i <= n; i++) entries.push(mkFile(String(i).padStart(2, '0') + '.dat'));
  return {
    kind: 'directory', name: 'root',
    values: async function* () { for (const e of entries) yield e; },
    getDirectoryHandle: async () => ({ kind: 'directory', getFile: async () => ({ lastModified: 0, size: 0 }), move: async () => {} }),
  };
}
// 走完整流程：选文件夹 → 填模板 → 点应用改名
async function pickAndRename(n, template) {
  win.isSecureContext = true;
  win.showDirectoryPicker = async () => fakeDir(n);
  elements['pickBtn']._fire('click');
  await sleep(50);
  elements['templateInput'].value = template;
  elements['templateInput']._fire('input');
  await sleep(200);
  elements['applyBtn']._fire('click');
  await sleep(50);
}

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
await test('计数：加载即读取服务端真值（123）', async () => {
  await sleep(30);
  assert.strictEqual(elements['renamed-count'].textContent, '123',
    '应显示服务端返回的 123，实际=' + elements['renamed-count'].textContent);
});

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
  await pickAndRename(3, '系列.<n>.dat');
  const afterHtml = elements['previewBody'].innerHTML;
  assert.ok(afterHtml.includes('系列.1.dat') && afterHtml.includes('系列.3.dat'), '应用后预览应为新名');
});

await test('计数：改名 3 个 → POST 上报 +3 并收敛到服务端真值 126', async () => {
  await sleep(30);
  assert.deepStrictEqual(countServer.posts, [3], '应 POST 一次，n=3，实际=' + JSON.stringify(countServer.posts));
  assert.strictEqual(countServer.value, 126, '服务端应累加到 126');
  assert.strictEqual(elements['renamed-count'].textContent, '126',
    '应以服务端返回值为准，实际=' + elements['renamed-count'].textContent);
});

await test('计数：被限流（429）时以服务端真值为准，界面不跳变', async () => {
  countServer.force429 = true;   // 模拟该 IP 已超限：服务端不累加，但仍返回真值
  await pickAndRename(2, '限流.<n>.dat');
  await sleep(30);
  assert.deepStrictEqual(countServer.posts, [3, 2], '仍应上报（服务端自行丢弃）');
  assert.strictEqual(countServer.value, 126, '超限不改计数');
  assert.strictEqual(elements['renamed-count'].textContent, '126',
    '应回落到服务端真值 126 而非停留乐观值 128，实际=' + elements['renamed-count'].textContent);
  countServer.force429 = false;
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

// 构造一个「顶层有文件、且含子文件夹」的 fake 文件夹（用于验证子文件夹提醒）
function fakeDirWithSub() {
  const mkFile = (name) => ({ kind: 'file', name, getFile: async () => ({ lastModified: 0, size: 0 }), move: async () => {} });
  const subdir = { kind: 'directory', name: 'sub', values: async function* () {}, getFile: async () => ({ lastModified: 0, size: 0 }) };
  return {
    kind: 'directory', name: 'root',
    values: async function* () { yield mkFile('01.dat'); yield subdir; },
  };
}

await test('拖入含子文件夹的目录 → 弹提醒，确认后回到主页（不加载）', async () => {
  win.isSecureContext = true;
  win.showDirectoryPicker = async () => fakeDirWithSub();
  elements['recursive'].checked = false;            // 默认不勾选「包含子文件夹」
  elements['pickBtn']._fire('click');
  await sleep(60);                                   // 等 loadFolder → scanTopLevel → 弹窗
  assert.strictEqual(elements['subModal'].hidden, false, '应弹出「包含子文件夹」提醒');
  elements['subConfirmBtn']._fire('click');          // 点「确认」
  await sleep(60);
  assert.strictEqual(elements['subModal'].hidden, true, '确认后弹窗应关闭');
  assert.strictEqual(elements['dropzone'].hidden, false, '确认后应回到主页（拖放区可见）');
  assert.strictEqual(elements['count'].textContent, '未加载文件', '确认后不应加载任何文件');
});

console.log(`\n通过 ${passed} 项测试` + (process.exitCode ? '（存在失败）' : '，全部通过 ✅'));
