// app.js — RenamerX 前端交互逻辑
import { computeRenames, resolveTargetPath } from './engine.js';
import { GH_DISPATCH_TOKEN, GH_REPO } from './config.js';

const GITHUB_URL = 'https://github.com/JohnWish1590/renamerx';
const PAGES_URL = 'https://johnwish1590.github.io/renamerx/';
const MAX_PREVIEW = 500;       // 预览表格最多渲染行数，防止 DOM 过大导致 OOM
const LARGE_FOLDER = 5000;     // 文件数超过此值时给出警告
const MAX_DEPTH = 10;          // 递归收集最大深度，防止符号链接死循环

const els = {
  pickBtn: document.getElementById('pickBtn'),
  recursive: document.getElementById('recursive'),
  sort: document.getElementById('sort'),
  order: document.getElementById('order'),
  count: document.getElementById('count'),
  reselectBtn: document.getElementById('reselectBtn'),
  renamedCount: document.getElementById('renamed-count'),
  dropzone: document.getElementById('dropzone'),
  templateInput: document.getElementById('templateInput'),
  templateNote: document.getElementById('templateNote'),
  applyBtn: document.getElementById('applyBtn'),
  previewBody: document.getElementById('previewBody'),
  status: document.getElementById('status'),
  banner: document.getElementById('banner'),
  pickCompatBtn: document.getElementById('pickCompatBtn'),
  dirInput: document.getElementById('dirInput'),
  tagPalette: document.getElementById('tagPalette'),
  toast: document.getElementById('toast'),
  selectAll: document.getElementById('selectAll'),
};

const state = {
  rootHandle: null,
  mode: 'fsa',          // 'fsa' = File System Access（直接改名）；'compat' = 兼容模式（导出脚本）
  compatRoot: '',       // 兼容模式选中的根文件夹名
  recursive: false,
  files: [],            // { handle, name, dirParts:[], ctime, mtime, size }
  templateOriginal: '',
  templateEdited: '',
  dirty: false,
};

// --------------------------------------------------------------------------
// 加载文件夹
// --------------------------------------------------------------------------
async function loadFromHandle(handle, recursive) {
  state.mode = 'fsa';
  state.compatRoot = '';
  state.rootHandle = handle;
  state.recursive = recursive;
  state.files = [];
  await collect(handle, [], recursive);
  resetTemplate();
  const warn = state.files.length > LARGE_FOLDER
    ? `（⚠ 该文件夹包含 ${state.files.length} 个文件，数量过大，建议分批处理或只处理子文件夹）`
    : '';
  setStatus(`已加载 ${state.files.length} 个文件。${warn}`, state.files.length > LARGE_FOLDER ? 'err' : 'ok');
  render();
}

async function collect(dirHandle, relParts, recursive) {
  if (relParts.length >= MAX_DEPTH) return;
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      let ctime = 0, mtime = 0, size = 0;
      try {
        const f = await entry.getFile();
        mtime = f.lastModified || 0;
        size = f.size || 0;
        ctime = mtime;
      } catch (_) { /* 某些文件无法读取，忽略 */ }
      state.files.push({ handle: entry, name: entry.name, dirParts: relParts, ctime, mtime, size, selected: true });
    } else if (entry.kind === 'directory' && recursive) {
      await collect(entry, relParts.concat(entry.name), recursive);
    }
  }
}

function resetTemplate() {
  const sorted = getSorted();
  const first = sorted.find(f => f.selected) || sorted[0];
  state.templateOriginal = first ? first.name : '';
  state.templateEdited = state.templateOriginal;
  state.dirty = false;
  els.templateInput.value = state.templateEdited;
  updateTemplateNote();
}

function updateTemplateNote() {
  els.templateNote.textContent = state.templateOriginal
    ? `模板来源（列表中排第一的文件）：「${state.templateOriginal}」`
    : '';
}

// --------------------------------------------------------------------------
// 排序
// --------------------------------------------------------------------------
function getSorted() {
  const key = els.sort.value;
  const asc = els.order.value !== 'desc';
  const arr = state.files.slice();
  arr.sort((a, b) => {
    let r = 0;
    if (key === 'size') r = a.size - b.size;
    else if (key === 'mtime') r = a.mtime - b.mtime;
    else r = a.name.localeCompare(b.name);
    return asc ? r : -r;
  });
  return arr;
}

// --------------------------------------------------------------------------
// 渲染预览
// --------------------------------------------------------------------------
function render() {
  const sorted = getSorted();
  const selected = sorted.filter(f => f.selected);

  // 计数文案：已加载 N 个，勾选 M 个待重命名
  els.count.textContent = sorted.length
    ? `已加载 ${sorted.length} 个文件，已勾选 ${selected.length} 个待重命名`
    : '未加载文件';

  // 模板来源跟随「第一个勾选的文件」；未手动编辑时让模板跟着它走
  const firstSel = sorted.find(f => f.selected);
  if (firstSel && state.templateOriginal !== firstSel.name) {
    state.templateOriginal = firstSel.name;
    if (!state.dirty) {
      state.templateEdited = firstSel.name;
      els.templateInput.value = state.templateEdited;
    }
    updateTemplateNote();
  }

  // 文件加载后自动隐藏 dropzone，进入编辑态；显示「重新选择」按钮
  els.dropzone.hidden = sorted.length > 0;
  els.reselectBtn.hidden = sorted.length === 0;

  if (!sorted.length) {
    els.previewBody.innerHTML = '';
    els.applyBtn.disabled = true;
    if (els.selectAll) { els.selectAll.checked = false; els.selectAll.indeterminate = false; }
    return;
  }

  const res = computeRenames({
    files: selected,
    templateOriginal: state.templateOriginal,
    templateEdited: state.templateEdited,
    options: { sort: els.sort.value, order: els.order.value },
  });

  // 与「未勾选文件」的现有名字冲突检测（防止把文件改名成另一个未勾选文件的名字）
  const unselKeys = new Set(
    state.files.filter(f => !f.selected).map(f => (f.dirParts || []).join('/') + '/' + f.name)
  );
  for (const r of res) {
    if (unselKeys.has(r.relativeKey)) r.warnings.push('目标名与未勾选的文件重名，将冲突');
  }

  const hasWarn = res.some(r => r.warnings.length);
  els.applyBtn.disabled = !selected.length || hasWarn || state.mode === 'compat';
  els.applyBtn.hidden = state.mode === 'compat';

  // 表头全选框状态
  if (els.selectAll) {
    els.selectAll.checked = selected.length === sorted.length;
    els.selectAll.indeterminate = selected.length > 0 && selected.length < sorted.length;
  }

  const renameMap = new Map(res.map(r => [r.file, r]));

  // 预览表格只渲染前 MAX_PREVIEW 行，避免超大文件夹把 DOM 撑爆导致 OOM
  const showCount = Math.min(sorted.length, MAX_PREVIEW);
  let html = '';
  for (let i = 0; i < showCount; i++) {
    const f = sorted[i];
    const isSel = f.selected;
    const r = renameMap.get(f);
    const newName = isSel ? r.renamed : f.name;
    const rowCls = isSel ? '' : ' class="row-unchecked"';
    html += `<tr${rowCls}>
      <td class="col-check"><input type="checkbox" class="row-check" data-idx="${i}" ${isSel ? 'checked' : ''} aria-label="选择 ${escapeHtml(f.name)}" /></td>
      <td class="col-idx">${i + 1}</td>
      <td class="col-old">${escapeHtml(f.name)}</td>
      <td class="col-new">${escapeHtml(newName)}</td>
    </tr>`;
  }
  if (sorted.length > MAX_PREVIEW) {
    html += `<tr><td class="col-check"></td><td class="col-idx">…</td><td colspan="2" class="warn-cell">` +
      `还有 ${sorted.length - MAX_PREVIEW} 个文件未在预览中显示（共 ${sorted.length} 个），应用时只处理勾选的文件。` +
      `</td></tr>`;
  }
  els.previewBody.innerHTML = html;

  if (hasWarn) {
    const n = res.filter(r => r.warnings.length).length;
    setStatus(`有 ${n} 个文件存在警告（冲突或非法字符），请修正模板后再应用。`, 'err');
  } else if (!selected.length) {
    setStatus('没有任何文件被勾选。请在预览表最左列勾选需要改名的文件。', 'err');
  } else if (sorted.length > MAX_PREVIEW) {
    setStatus(`预览已更新（仅显示前 ${MAX_PREVIEW} 个，共 ${sorted.length} 个，已勾选 ${selected.length} 个）。确认无误后点击「应用重命名」。`, 'ok');
  } else if (state.mode === 'compat') {
    setStatus('兼容模式仅可预览，真实改名请用 Chrome / Edge 在线打开本页。', 'ok');
  } else {
    setStatus(`预览已更新，已勾选 ${selected.length} 个文件。确认无误后点击「应用重命名」。`, 'ok');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setStatus(msg, kind) {
  els.status.textContent = msg;
  els.status.className = 'status' + (kind ? ' ' + kind : '');
}

// 轻量提示气泡：应用重命名后弹出，2.6s 后自动消失（clear 的反馈，避免「点了没反应」）
let toastTimer;
function showToast(msg, type = 'ok') {
  const el = els.toast;
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.className = 'toast ' + type + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast ' + type;
    el.hidden = true;
  }, 2600);
}

// 改名完成后通知父页面（用于发布站的人气计数）。在 iframe 内才发送，直接打开时不打扰。
function notifyRenamed(count) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'renamerx:renamed', count: count }, '*');
    }
  } catch (_) { /* 跨域或被拦截时静默忽略 */ }
}

// 全网共享计数：count.json 是「唯一真相来源」，所有浏览器都读同一个数字，
// 因此任何人看到的「已重命名」都完全一致。本地不再用 localStorage 持久化，
// 避免不同浏览器看到不一样的累计值。
function fmtNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function setRenamedCountText(n) {
  const el = els.renamedCount || document.getElementById('renamed-count');
  if (el) el.textContent = fmtNum(n);
}

const COUNT_RAW = `https://raw.githubusercontent.com/${GH_REPO}/main/count.json`;
const DISPATCH_URL = `https://api.github.com/repos/${GH_REPO}/actions/workflows/bump-count.yml/dispatches`;
let sharedCount = null;   // 最近一次读到的全网真实总数（null 表示还没读到）

async function fetchSharedCount() {
  try {
    const r = await fetch(COUNT_RAW, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return (j && typeof j.renamed === 'number') ? j.renamed : null;
  } catch (_) { return null; }
}

// 加载时：只显示全网共享值（count.json）。这就是所有浏览器统一的那个数字。
async function loadRenamedCount() {
  const shared = await fetchSharedCount();
  if (shared !== null) {
    sharedCount = shared;
    setRenamedCountText(shared);
  }
}

// 改名成功后：先「乐观」显示 sharedCount + N 给即时反馈，同时触发 Action 让全网 +N；
// 等 GitHub Action 把新数写回 count.json（约几秒）后，再读一次「回正」，
// 使所有浏览器最终都收敛到同一个真实总数。
function addRenamedCount(n) {
  const base = sharedCount !== null ? sharedCount : 0;
  setRenamedCountText(base + n);
  triggerBump(n);
  setTimeout(async () => {
    const shared = await fetchSharedCount();
    if (shared !== null) {
      sharedCount = shared;
      setRenamedCountText(shared);
    }
  }, 5000);
}

// 触发 GitHub Action 累加（需要 fine-grained 限定 token；未配置则不触发）
async function triggerBump(n) {
  if (!GH_DISPATCH_TOKEN) return;
  try {
    await fetch(DISPATCH_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + GH_DISPATCH_TOKEN,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { count: String(n) } }),
    });
  } catch (_) { /* 触发失败不影响本机显示 */ }
}

// 不蒜子异步渲染，轮询格式化数字（页脚/统计条都可能出现，统一更新所有同名 id）
function fmtBusuanzi() {
  const timer = setInterval(() => {
    let changed = false;
    document.querySelectorAll('#busuanzi_value_site_uv').forEach(el => {
      const text = el.textContent || '';
      const n = parseInt(text.replace(/,/g, '').replace(/—/g, ''), 10);
      if (!isNaN(n) && n > 0) {
        const formatted = fmtNum(n);
        if (el.textContent !== formatted) {
          el.textContent = formatted;
          changed = true;
        }
      }
    });
    if (changed) clearInterval(timer);
  }, 300);
  setTimeout(() => clearInterval(timer), 6000);
}

// --------------------------------------------------------------------------
// 目标路径解析（支持 / 与 ../ 归档、上移）—— 实现见 engine.js 的 resolveTargetPath
// --------------------------------------------------------------------------
async function resolveParent(rootHandle, parts) {
  let h = rootHandle;
  for (const p of parts) h = await h.getDirectoryHandle(p, { create: true });
  return h;
}

// --------------------------------------------------------------------------
// 应用重命名
// --------------------------------------------------------------------------
async function applyRenames() {
  // 包裹全局 try-catch：任何意外异常都逼到状态栏，避免「点了没反应又无提示」
  try {
    if (state.mode === 'compat' || !state.rootHandle) {
      setStatus('当前无法真实改名。兼容模式或 file:// 打开时，请使用「导出重命名脚本」手动执行。', 'err');
      showToast('⚠️ 当前无法真实改名（兼容模式 / file://）', 'err');
      return;
    }
    setStatus(`正在应用重命名…（已勾选 ${getSorted().filter(f => f.selected).length} 个文件）`, 'ok');
    const sorted = getSorted();
    const selected = sorted.filter(f => f.selected);
    if (!selected.length) {
      setStatus('没有勾选任何要重命名的文件。请在预览表最左列勾选需要改名的文件。', 'err');
      showToast('⚠️ 没有勾选要重命名的文件', 'err');
      return;
    }
    const res = computeRenames({
      files: selected,
      templateOriginal: state.templateOriginal,
      templateEdited: state.templateEdited,
      options: { sort: els.sort.value, order: els.order.value },
    });

    // 与未勾选文件冲突检测：若新名与某个未勾选文件现有名相同，改名会失败，提前阻止
    const unselKeys = new Set(
      state.files.filter(f => !f.selected).map(f => (f.dirParts || []).join('/') + '/' + f.name)
    );
    for (const r of res) {
      if (unselKeys.has(r.relativeKey)) {
        setStatus(`目标名「${r.renamed}」与未勾选的文件「${r.original}」重名，已阻止重命名。`, 'err');
        showToast('⚠️ 存在与未勾选文件重名的冲突', 'err');
        return;
      }
    }

    if (res.some(r => r.warnings.length)) {
      setStatus('存在冲突或非法字符，已阻止重命名。', 'err');
      showToast('⚠️ 存在冲突或非法字符，已阻止重命名', 'err');
      return;
    }
    if (!('move' in (selected[0]?.handle || {}))) {
      setStatus('当前浏览器不支持真实重命名（需要 Chrome / Edge 新版）。', 'err');
      showToast('⚠️ 当前浏览器不支持真实重命名', 'err');
      return;
    }

    let ok = 0;
    for (let i = 0; i < res.length; i++) {
      const r = res[i];
      const f = selected[i];
      try {
        const { parent, base } = resolveTargetPath(f, r.renamed);
        const parentHandle = await resolveParent(state.rootHandle, parent);
        await f.handle.move(parentHandle, base);
        f.name = base;
        f.dirParts = parent;
        ok++;
      } catch (e) {
        const msg = e && e.message ? e.message : e;
        setStatus(`重命名失败：${msg}`, 'err');
        showToast(`❌ 重命名失败：${msg}`, 'err');
        break;
      }
    }
    if (ok > 0) {
      setStatus(`成功重命名 ${ok} 个文件。`, 'ok');
      showToast(`✅ 成功重命名 ${ok} 个文件`, 'ok');
      addRenamedCount(ok);
      notifyRenamed(ok);
    } else {
      setStatus('没有任何文件被重命名（可能目标名与原名相同，或 move 未生效）。', 'err');
      showToast('⚠️ 没有文件被重命名', 'err');
    }
    render();
  } catch (e) {
    setStatus(`应用重命名时发生异常：${e && e.message ? e.message : e}`, 'err');
  }
}

// --------------------------------------------------------------------------
// 兼容模式：用 <input webkitdirectory> 加载文件（file:// 或非安全上下文可用）
//   浏览器无法在 file:// 下真实改名，但可预览并导出 PowerShell 重命名脚本
// --------------------------------------------------------------------------
async function loadFromCompat(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  state.mode = 'compat';
  state.rootHandle = null;
  state.recursive = true; // webkitdirectory 已含全部子文件夹
  state.files = [];

  let rootName = '';
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name;
    const parts = rel.split('/');
    const leaf = parts.pop();
    if (!rootName && parts.length) rootName = parts[0];
    const dirParts = parts.slice(1); // 去掉根文件夹名，得到相对目录层级
    state.files.push({
      handle: null,
      name: leaf,
      dirParts,
      ctime: 0,
      mtime: f.lastModified || 0,
      size: f.size || 0,
      selected: true,
    });
  }
  state.compatRoot = rootName || '选中的文件夹';
  resetTemplate();
  const warn = state.files.length > LARGE_FOLDER
    ? `（⚠ 该文件夹包含 ${state.files.length} 个文件，数量过大，建议分批处理）`
    : '';
  setStatus(`兼容模式已加载 ${state.files.length} 个文件（来自「${state.compatRoot}」）。${warn}`, state.files.length > LARGE_FOLDER ? 'err' : 'ok');
  render();
}

// --------------------------------------------------------------------------
// 横幅 & 全局拖拽拦截
// --------------------------------------------------------------------------
function showBanner(html) {
  els.banner.innerHTML = html;
  els.banner.hidden = false;
}
function hideBanner() { els.banner.hidden = true; }

function maybeShowBanner() {
  if (location.protocol === 'file:') {
    showBanner(
      '⚠️ <strong>你正在用「直接双击 HTML」的方式打开</strong>，浏览器出于安全限制：' +
      '①「选择文件夹」按钮和拖拽<strong>无法读取</strong>本机文件；②也无法<strong>真实改名</strong>。' +
      '请访问在线版 <a href="' + PAGES_URL + '" target="_blank" rel="noopener">RenamerX 网页版</a> 用 Chrome / Edge 直接改名。'
    );
  }
}

// 全局拦截文件拖拽，阻止浏览器把文件夹当作下载/打开
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => {
  window.addEventListener(ev, e => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault();
    }
  });
});

// --------------------------------------------------------------------------
// 事件绑定
// --------------------------------------------------------------------------
async function pickFolder() {
  if (!window.isSecureContext || !window.showDirectoryPicker) {
    showBanner(); // 确保在 file:// 下给出提示
    setStatus('当前为 file:// 模式，「选择文件夹」不可用。请点「兼容模式选择」，或访问在线网页版。', 'err');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker();
    await loadFromHandle(handle, els.recursive.checked);
  } catch (e) {
    if (e.name !== 'AbortError') setStatus(`选择失败：${e.message}`, 'err');
  }
}

function resetTool() {
  state.files = [];
  state.rootHandle = null;
  state.mode = 'fsa';
  state.compatRoot = '';
  state.templateOriginal = '';
  state.templateEdited = '';
  state.dirty = false;
  els.templateInput.value = '';
  updateTemplateNote();
  els.previewBody.innerHTML = '';
  els.applyBtn.disabled = true;
  els.applyBtn.hidden = false;
  els.dropzone.hidden = false;
  els.reselectBtn.hidden = true;
  els.count.textContent = '未加载文件';
  hideBanner();
  setStatus('选择或拖入一个文件夹开始；若双击打开 HTML，请使用「兼容模式选择」。');
}

els.pickBtn.addEventListener('click', pickFolder);
els.reselectBtn.addEventListener('click', resetTool);

els.recursive.addEventListener('change', () => {
  if (state.rootHandle) loadFromHandle(state.rootHandle, els.recursive.checked);
});

els.sort.addEventListener('change', () => { resetTemplate(); render(); });
els.order.addEventListener('change', () => { resetTemplate(); render(); });

let renderTimeout;
els.templateInput.addEventListener('input', () => {
  state.templateEdited = els.templateInput.value;
  state.dirty = true;
  clearTimeout(renderTimeout);
  renderTimeout = setTimeout(render, 120);
});

// 一键插入标签：把对应标签插到光标处，免去背语法
function insertTag(tag) {
  const inp = els.templateInput;
  const start = inp.selectionStart == null ? inp.value.length : inp.selectionStart;
  const end = inp.selectionEnd == null ? inp.value.length : inp.selectionEnd;
  const v = inp.value;
  inp.value = v.slice(0, start) + tag + v.slice(end);
  const pos = start + tag.length;
  try { inp.setSelectionRange(pos, pos); } catch (_) {}
  inp.focus();
  state.templateEdited = inp.value;
  state.dirty = true;
  clearTimeout(renderTimeout);
  renderTimeout = setTimeout(render, 120);
}
els.tagPalette.addEventListener('click', e => {
  const btn = e.target.closest('button[data-tag]');
  if (!btn) return;
  insertTag(btn.getAttribute('data-tag'));
});

els.applyBtn.addEventListener('click', applyRenames);

// 预览表复选框：勾选 / 取消勾选决定哪些文件参与重命名（事件委托，行是每次重渲染生成的）
els.previewBody.addEventListener('change', e => {
  const cb = e.target.closest('input.row-check');
  if (!cb) return;
  const idx = Number(cb.dataset.idx);
  const f = getSorted()[idx];
  if (f) { f.selected = cb.checked; render(); }
});
// 表头全选框：一键勾选 / 取消勾选全部
if (els.selectAll) {
  els.selectAll.addEventListener('change', () => {
    const on = els.selectAll.checked;
    for (const f of state.files) f.selected = on;
    render();
  });
}

// 拖拽文件夹
['dragenter', 'dragover'].forEach(ev => els.dropzone.addEventListener(ev, e => {
  e.preventDefault(); els.dropzone.classList.add('drag');
}));
['dragleave', 'drop'].forEach(ev => els.dropzone.addEventListener(ev, e => {
  e.preventDefault(); els.dropzone.classList.remove('drag');
}));
els.dropzone.addEventListener('drop', async e => {
  const item = e.dataTransfer.items && e.dataTransfer.items[0];
  if (!item) return;
  if (!window.isSecureContext || !item.getAsFileSystemHandle) {
    showBanner();
    setStatus('当前为 file:// 模式，拖拽无法读取文件夹。请点「兼容模式选择」。', 'err');
    return;
  }
  let handle = null;
  try { handle = await item.getAsFileSystemHandle(); } catch (_) {}
  if (handle && handle.kind === 'directory') {
    await loadFromHandle(handle, els.recursive.checked);
  } else {
    setStatus('请拖入一个文件夹。', 'err');
  }
});

// 兼容模式：用 <input webkitdirectory> 加载文件
els.pickCompatBtn.addEventListener('click', () => {
  els.dirInput.value = ''; // 允许重复选择同一文件夹
  els.dirInput.click();
});
els.dirInput.addEventListener('change', () => loadFromCompat(els.dirInput));

maybeShowBanner();
loadRenamedCount();
fmtBusuanzi();
setStatus('选择或拖入一个文件夹开始；若双击打开 HTML，请使用「兼容模式选择」。');
