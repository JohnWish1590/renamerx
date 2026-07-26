// app.js — RenamerX 前端交互逻辑
import { computeRenames, resolveTargetPath } from './engine.js';

const GITHUB_URL = 'https://github.com/JohnWish1590/renamerx';

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
};
els.githubLink.href = GITHUB_URL;

const state = {
  rootHandle: null,
  recursive: false,
  files: [],            // { handle, name, dirParts:[], ctime, mtime, size }
  templateOriginal: '',
  templateEdited: '',
  dirty: false,
  undoStack: [],
};

// --------------------------------------------------------------------------
// 加载文件夹
// --------------------------------------------------------------------------
async function loadFromHandle(handle, recursive) {
  state.rootHandle = handle;
  state.recursive = recursive;
  state.undoStack = [];
  els.undoBtn.disabled = true;
  state.files = [];
  await collect(handle, [], recursive);
  resetTemplate();
  setStatus(`已加载 ${state.files.length} 个文件。`, 'ok');
  render();
}

async function collect(dirHandle, relParts, recursive) {
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

  let html = '';
  res.forEach((r, i) => {
    const warnCls = r.warnings.length ? 'row-warn' : '';
    const warnTxt = r.warnings.map(w => `⚠ ${w}`).join('；');
    html += `<tr class="${warnCls}">
      <td class="col-idx">${i + 1}</td>
      <td class="col-old">${escapeHtml(r.original)}</td>
      <td class="col-new">${escapeHtml(r.renamed)}</td>
      <td class="warn-cell">${escapeHtml(warnTxt)}</td>
    </tr>`;
  });
  els.previewBody.innerHTML = html;

  if (hasWarn) {
    const n = res.filter(r => r.warnings.length).length;
    setStatus(`有 ${n} 个文件存在警告（冲突或非法字符），请修正模板后再应用。`, 'err');
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
// 事件绑定
// --------------------------------------------------------------------------
els.pickBtn.addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    setStatus('当前浏览器不支持文件夹选择，请使用 Chrome / Edge。', 'err');
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
  let handle = null;
  if (item.getAsFileSystemHandle) handle = await item.getAsFileSystemHandle();
  if (handle && handle.kind === 'directory') {
    await loadFromHandle(handle, els.recursive.checked);
  } else {
    setStatus('请拖入一个文件夹。', 'err');
  }
});

setStatus('选择或拖入一个文件夹开始。');
