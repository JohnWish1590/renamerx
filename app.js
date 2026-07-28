// app.js — RenamerX 前端交互逻辑
import { computeRenames, resolveTargetPath } from './engine.js';
import { buildPowerShellScript } from './scriptgen.js';

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
  dropzone: document.getElementById('dropzone'),
  templateInput: document.getElementById('templateInput'),
  templateNote: document.getElementById('templateNote'),
  applyBtn: document.getElementById('applyBtn'),
  undoBtn: document.getElementById('undoBtn'),
  previewBody: document.getElementById('previewBody'),
  status: document.getElementById('status'),
  githubLink: document.getElementById('githubLink'),
  banner: document.getElementById('banner'),
  pickCompatBtn: document.getElementById('pickCompatBtn'),
  dirInput: document.getElementById('dirInput'),
  exportBtn: document.getElementById('exportBtn'),
  tagPalette: document.getElementById('tagPalette'),
};
els.githubLink.href = GITHUB_URL;

const state = {
  rootHandle: null,
  mode: 'fsa',          // 'fsa' = File System Access（直接改名）；'compat' = 兼容模式（导出脚本）
  compatRoot: '',       // 兼容模式选中的根文件夹名
  recursive: false,
  files: [],            // { handle, name, dirParts:[], ctime, mtime, size }
  templateOriginal: '',
  templateEdited: '',
  dirty: false,
  undoStack: [],
  lastResults: [],      // 最近一次 computeRenames 的结果（供导出脚本使用）
};

// --------------------------------------------------------------------------
// 加载文件夹
// --------------------------------------------------------------------------
async function loadFromHandle(handle, recursive) {
  state.mode = 'fsa';
  state.compatRoot = '';
  state.rootHandle = handle;
  state.recursive = recursive;
  state.undoStack = [];
  els.undoBtn.disabled = true;
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
      state.files.push({ handle: entry, name: entry.name, dirParts: relParts, ctime, mtime, size });
    } else if (entry.kind === 'directory' && recursive) {
      await collect(entry, relParts.concat(entry.name), recursive);
    }
  }
}

function resetTemplate() {
  const sorted = getSorted();
  state.templateOriginal = sorted.length ? sorted[0].name : '';
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
  els.count.textContent = `${state.files.length} 个文件`;
  state.templateOriginal = sorted.length ? sorted[0].name : '';

  if (!sorted.length) {
    els.previewBody.innerHTML = '';
    els.applyBtn.disabled = true;
    els.applyBtn.hidden = false;
    els.undoBtn.hidden = true;
    els.exportBtn.hidden = true;
    return;
  }

  const res = computeRenames({
    files: sorted,
    templateOriginal: state.templateOriginal,
    templateEdited: state.templateEdited,
    options: { sort: els.sort.value, order: els.order.value },
  });

  const hasWarn = res.some(r => r.warnings.length);
  els.applyBtn.disabled = hasWarn;
  els.exportBtn.disabled = hasWarn;

  // 预览表格只渲染前 MAX_PREVIEW 行，避免超大文件夹把 DOM 撑爆导致 OOM
  const showCount = Math.min(res.length, MAX_PREVIEW);
  let html = '';
  for (let i = 0; i < showCount; i++) {
    const r = res[i];
    const warnCls = r.warnings.length ? 'row-warn' : '';
    const warnTxt = r.warnings.map(w => `⚠ ${w}`).join('；');
    html += `<tr class="${warnCls}">
      <td class="col-idx">${i + 1}</td>
      <td class="col-old">${escapeHtml(r.original)}</td>
      <td class="col-new">${escapeHtml(r.renamed)}</td>
      <td class="warn-cell">${escapeHtml(warnTxt)}</td>
    </tr>`;
  }
  if (res.length > MAX_PREVIEW) {
    html += `<tr><td class="col-idx">…</td><td colspan="3" class="warn-cell">` +
      `还有 ${res.length - MAX_PREVIEW} 个文件未在预览中显示（共 ${res.length} 个），导出/应用时仍会处理全部文件。` +
      `</td></tr>`;
  }
  els.previewBody.innerHTML = html;
  state.lastResults = res;

  if (state.mode === 'compat') {
    // 兼容模式：无法真实改名，只能导出脚本
    els.applyBtn.hidden = true;
    els.undoBtn.hidden = true;
    els.exportBtn.hidden = false;
  } else {
    els.applyBtn.hidden = false;
    els.undoBtn.hidden = state.undoStack.length === 0;
    els.exportBtn.hidden = true;
  }

  if (hasWarn) {
    const n = res.filter(r => r.warnings.length).length;
    setStatus(`有 ${n} 个文件存在警告（冲突或非法字符），请修正模板后再应用。`, 'err');
  } else if (res.length > MAX_PREVIEW) {
    setStatus(`预览已更新（仅显示前 ${MAX_PREVIEW} 个，共 ${res.length} 个）。确认无误后点击「应用重命名」或「导出脚本」。`, 'ok');
  } else if (state.mode === 'compat') {
    setStatus('兼容模式预览完成。点击「导出重命名脚本」下载 PowerShell 脚本，手动运行即可完成改名。', 'ok');
  } else {
    setStatus('预览已更新，确认无误后点击「应用重命名」。', 'ok');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setStatus(msg, kind) {
  els.status.textContent = msg;
  els.status.className = 'status' + (kind ? ' ' + kind : '');
}

// 改名完成后通知父页面（用于发布站的人气计数）。在 iframe 内才发送，直接打开时不打扰。
function notifyRenamed(count) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'renamerx:renamed', count: count }, '*');
    }
  } catch (_) { /* 跨域或被拦截时静默忽略 */ }
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
      return;
    }
    setStatus(`正在应用重命名…（已加载 ${state.files.length} 个文件，rootHandle=${!!state.rootHandle}）`, 'ok');
    const sorted = getSorted();
    if (!sorted.length) {
      setStatus('没有需要重命名的文件。', 'err');
      return;
    }
    const res = computeRenames({
      files: sorted,
      templateOriginal: state.templateOriginal,
      templateEdited: state.templateEdited,
      options: { sort: els.sort.value, order: els.order.value },
    });
    if (res.some(r => r.warnings.length)) {
      setStatus('存在冲突或非法字符，已阻止重命名。', 'err');
      return;
    }
    if (!('move' in (sorted[0]?.handle || {}))) {
      setStatus('当前浏览器不支持真实重命名（需要 Chrome / Edge 新版）。', 'err');
      return;
    }

    const undoList = [];
    let ok = 0;
    for (let i = 0; i < res.length; i++) {
      const r = res[i];
      const f = sorted[i];
      try {
        const { parent, base } = resolveTargetPath(f, r.renamed);
        const parentHandle = await resolveParent(state.rootHandle, parent);
        await f.handle.move(parentHandle, base);
        undoList.push({ handle: f.handle, origName: f.name, origDirParts: f.dirParts.slice() });
        f.name = base;
        f.dirParts = parent;
        ok++;
      } catch (e) {
        setStatus(`重命名失败：${e && e.message ? e.message : e}`, 'err');
        break;
      }
    }
    if (undoList.length) {
      state.undoStack.push(undoList);
      els.undoBtn.disabled = false;
      setStatus(`成功重命名 ${ok} 个文件。可点击「撤销」回退。`, 'ok');
    } else {
      setStatus('没有任何文件被重命名（可能目标名与原名相同，或 move 未生效）。', 'err');
    }
    if (ok > 0) notifyRenamed(ok);
    render();
  } catch (e) {
    setStatus(`应用重命名时发生异常：${e && e.message ? e.message : e}`, 'err');
  }
}

async function undo() {
  const undoList = state.undoStack.pop();
  if (!undoList) return;
  let ok = 0;
  for (const u of undoList) {
    try {
      const parentHandle = await resolveParent(state.rootHandle, u.origDirParts);
      await u.handle.move(parentHandle, u.origName);
      ok++;
    } catch (e) {
      setStatus(`撤销失败：${e.message}`, 'err');
    }
  }
  els.undoBtn.disabled = state.undoStack.length === 0;
  // 重新读取文件状态
  const recursive = state.recursive;
  const root = state.rootHandle;
  state.files = [];
  await collect(root, [], recursive);
  render();
  setStatus(`已撤销 ${ok} 个文件的重命名。`, 'ok');
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
  state.undoStack = [];
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
// 导出脚本（PowerShell 生成逻辑见 scriptgen.js，可直接单元测试）
// --------------------------------------------------------------------------
function downloadScript() {
  if (!state.lastResults.length) return;
  const script = buildPowerShellScript(state.lastResults, state.compatRoot);
  const blob = new Blob([script], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'renamerx-export.ps1';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus('已导出 renamerx-export.ps1，请在选中的根文件夹中用 PowerShell 运行。', 'ok');
  if (state.lastResults.length) notifyRenamed(state.lastResults.length);
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
      '请改用「<strong>兼容模式选择</strong>」加载文件预览并导出 PowerShell 脚本手动运行；' +
      '或访问在线版 <a href="' + PAGES_URL + '" target="_blank" rel="noopener">RenamerX 网页版</a> 用 File System Access 直接改名。'
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
els.pickBtn.addEventListener('click', async () => {
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
});

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
els.undoBtn.addEventListener('click', undo);

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
els.exportBtn.addEventListener('click', downloadScript);

maybeShowBanner();
setStatus('选择或拖入一个文件夹开始；若双击打开 HTML，请使用「兼容模式选择」。');
