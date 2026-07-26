// app.js — RenamerX 前端交互逻辑
import { computeRenames, resolveTargetPath } from './engine.js';

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
  if (!state.rootHandle) return;
  const sorted = getSorted();
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
    setStatus('当前浏览器不支持真实重命名（需要 Chrome / Edge）。', 'err');
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
      setStatus(`重命名失败：${e.message}`, 'err');
      break;
    }
  }
  if (undoList.length) {
    state.undoStack.push(undoList);
    els.undoBtn.disabled = false;
    setStatus(`成功重命名 ${ok} 个文件。可点击「撤销」回退。`, 'ok');
  }
  render();
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
// 生成 PowerShell 重命名脚本（兼容模式导出）
//   采用两阶段重命名：先全部移到唯一临时名，再临时名 -> 最终名，
//   可安全处理循环改名（如 a->b, b->a）与归档到子目录。
// --------------------------------------------------------------------------
function buildPowerShellScript(results, rootName) {
  const winPath = p => p.replace(/\//g, '\\');
  const ps = s => "'" + String(s).replace(/'/g, "''") + "'";

  const lines = [];
  lines.push('# ' + '='.repeat(58));
  lines.push('# RenamerX 生成的批量重命名脚本');
  lines.push('# 根文件夹（你选中的文件夹）：' + rootName);
  lines.push('#');
  lines.push('# 使用方法：');
  lines.push('#   1. 打开 PowerShell');
  lines.push('#   2. cd "你的根文件夹路径"');
  lines.push('#   3. 运行：.\\renamerx-export.ps1');
  lines.push('#');
  lines.push('# ⚠ 脚本会真实移动 / 重命名你的文件，运行前请确认已备份！');
  lines.push('# ' + '='.repeat(58));
  lines.push('$ErrorActionPreference = \'Stop\'');
  lines.push('');

  const dirSet = new Set();
  const moves = [];
  results.forEach((r, i) => {
    const { parent, base } = resolveTargetPath(r.file, r.renamed);
    const srcRel = (r.file.dirParts || []).concat(r.file.name).join('/');
    const targetDir = parent.join('/');
    const newRel = (targetDir ? targetDir + '/' : '') + base;
    const tmp = (targetDir ? targetDir + '/' : '') + '.renx_tmp_' + i + '_' + Math.random().toString(16).slice(2, 8);
    if (targetDir) dirSet.add(targetDir);
    moves.push({ srcRel, newRel, tmp });
  });

  if (dirSet.size) {
    lines.push('# ---- 创建目标子目录 ----');
    for (const d of [...dirSet].sort()) {
      lines.push('New-Item -ItemType Directory -Force -Path ' + ps(winPath(d)) + ' | Out-Null');
    }
    lines.push('');
  }

  lines.push('# ---- 阶段一：全部先移到唯一临时名（避免循环冲突）----');
  for (const m of moves) {
    lines.push('Move-Item -LiteralPath ' + ps(winPath(m.srcRel)) + ' -Destination ' + ps(winPath(m.tmp)));
  }
  lines.push('');
  lines.push('# ---- 阶段二：临时名 -> 最终名 ----');
  for (const m of moves) {
    lines.push('Move-Item -LiteralPath ' + ps(winPath(m.tmp)) + ' -Destination ' + ps(winPath(m.newRel)));
  }
  lines.push('');
  lines.push('Write-Host "RenamerX：已完成 ' + results.length + ' 个文件的重命名。"');
  return lines.join('\r\n');
}

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

els.templateInput.addEventListener('input', () => {
  state.templateEdited = els.templateInput.value;
  state.dirty = true;
  render();
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
