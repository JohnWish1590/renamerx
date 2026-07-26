// engine.js — 框架无关的重命名引擎（RenamerX，SmanRenamer 的开源继任者）
//
// 设计目标：复刻 SmanRenamer 的「模板式重命名」核心思想——
//   拖入一批结构相似的文件后，其中一个文件名成为「重命名模板」，
//   用户只修改这一个名字，引擎通过「单词对齐 + 变换传播」把改动套用到全部文件，
//   并支持一套标签：<n> 自动编号、<dir,x> 父目录名、<r,x> 随机字符、<abc> 原样文本、/ 归档到子目录。
//
// 该文件同时可在浏览器（<script type="module">）和 Node（ESM）中运行，便于单元测试。

// ---------------------------------------------------------------------------
// 字符分类
// ---------------------------------------------------------------------------
function isWordChar(ch) {
  // Unicode 字母或数字视为「单词字符」，其余视为「分隔符」
  return /\p{L}|\p{N}/u.test(ch);
}

// ---------------------------------------------------------------------------
// 分词
//   parseTags=true 时，把 <...> 解析为 tag 令牌（仅用于编辑后的模板）
// ---------------------------------------------------------------------------
export function tokenize(text, parseTags = false) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (parseTags && text[i] === '<') {
      const end = text.indexOf('>', i + 1);
      if (end !== -1) {
        tokens.push({ kind: 'tag', text: text.slice(i, end + 1), inner: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    const word = isWordChar(text[i]);
    let j = i + 1;
    while (j < n) {
      if (parseTags && text[j] === '<') break;
      if (isWordChar(text[j]) !== word) break;
      j++;
    }
    tokens.push({ kind: word ? 'word' : 'sep', text: text.slice(i, j) });
    i = j;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// 基于种类的 LCS 对齐（用于把目标文件令牌序列对齐到模板原始序列）
// ---------------------------------------------------------------------------
function lcsAlignment(a, b, matchFn) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = matchFn(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (matchFn(a[i], b[j])) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// 由对齐结果生成有序的编辑操作（equal / replace / delete / insert）
function buildOps(a, b, pairs) {
  const ops = [];
  let i = 0, j = 0, p = 0;
  const nextAi = () => (p < pairs.length ? pairs[p][0] : Infinity);
  const nextBj = () => (p < pairs.length ? pairs[p][1] : Infinity);
  while (i < a.length || j < b.length) {
    if (p < pairs.length && pairs[p][0] === i && pairs[p][1] === j) {
      ops.push({ type: a[i].text === b[j].text ? 'equal' : 'replace', ai: i, bj: j });
      i++; j++; p++;
    } else if (i < a.length && nextAi() === i) {
      // 当前 a[i] 会在之后与某个 b 匹配，说明 b[j] 是多余的 -> 插入
      ops.push({ type: 'insert', bj: j }); j++;
    } else if (j < b.length && nextBj() === j) {
      // 当前 b[j] 会在之后与某个 a 匹配，说明 a[i] 是多余的 -> 删除
      ops.push({ type: 'delete', ai: i }); i++;
    } else if (i < a.length && j < b.length) {
      // 两者互不相对，且都不会与未来匹配 -> 删除+插入
      ops.push({ type: 'delete', ai: i });
      ops.push({ type: 'insert', bj: j });
      i++; j++;
    } else if (i < a.length) {
      ops.push({ type: 'delete', ai: i }); i++;
    } else {
      ops.push({ type: 'insert', bj: j }); j++;
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// 标签求值
// ---------------------------------------------------------------------------
function digits(n) { return String(Math.max(0, Math.floor(n))).length; }
function pad(v, w) { return String(v).padStart(w, '0'); }
function randChars(charset, len, rng) {
  rng = rng || Math.random;
  let s = '';
  for (let i = 0; i < len; i++) s += charset[Math.floor(rng() * charset.length)];
  return s;
}

export function evaluateTag(inner, ctx, rng) {
  const t = inner.trim();
  let m;
  if (t === 'n') return pad(ctx.index, digits(ctx.total));
  if ((m = /^n,(\d+)$/.exec(t))) {
    const x = +m[1];
    const max = x + ctx.total - 1;
    return pad(x + ctx.index - 1, digits(max));
  }
  if (t === 'dir' || t === 'dir,1') return ctx.dirParts.length ? ctx.dirParts[ctx.dirParts.length - 1] : '';
  if ((m = /^dir,(\d+)$/.exec(t))) {
    const x = +m[1];
    const idx = ctx.dirParts.length - x;
    return idx >= 0 ? ctx.dirParts[idx] : '';
  }
  if (t === 'r') return randChars('0123456789', 6, rng);
  if ((m = /^r,(\d+)$/.exec(t)) || (m = /^rn,(\d+)$/.exec(t))) return randChars('0123456789', +m[1], rng);
  if ((m = /^rl,(\d+)$/.exec(t))) return randChars('abcdefghijklmnopqrstuvwxyz', +m[1], rng);
  if ((m = /^ru,(\d+)$/.exec(t))) return randChars('ABCDEFGHIJKLMNOPQRSTUVWXYZ', +m[1], rng);
  if ((m = /^ra,(\d+)$/.exec(t))) return randChars('abcdefghijklmnopqrstuvwxyz0123456789', +m[1], rng);
  if ((m = /^rA,(\d+)$/.exec(t))) return randChars('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', +m[1], rng);
  if ((m = /^r([\s\S]+?),(\d+)$/.exec(t)) && m[1].length > 0) return randChars(m[1], +m[2], rng);
  // 未识别的 <...> 视为原样文本（即 <abc> 输出 abc，<P> 输出 P）
  return t;
}

// ---------------------------------------------------------------------------
// 单词变换：把模板原始词 -> 编辑词 的关系套用到目标词
// ---------------------------------------------------------------------------
function transformWord(etext, origText, targetText) {
  if (targetText == null) return etext;            // 目标里没有对应词 -> 原样输出
  if (etext === origText) return targetText;        // 完全相同
  // 前缀：编辑词是原始词的前 k 个字符（0<k<len）
  if (etext.length > 0 && etext.length < origText.length && origText.startsWith(etext)) {
    return targetText.slice(0, etext.length);
  }
  // 后缀：编辑词是原始词的后 k 个字符
  if (etext.length > 0 && etext.length < origText.length && origText.endsWith(etext)) {
    return targetText.slice(-etext.length);
  }
  // 大小写变换
  if (etext.toLowerCase() === origText.toLowerCase()) {
    if (/[a-zA-Z]/.test(etext) && etext === etext.toUpperCase()) return targetText.toUpperCase();
    if (/[a-zA-Z]/.test(etext) && etext === etext.toLowerCase()) return targetText.toLowerCase();
    if (/[a-zA-Z]/.test(etext) && etext[0] === etext[0].toUpperCase() && etext.slice(1) === etext.slice(1).toLowerCase()) {
      return targetText.charAt(0).toUpperCase() + targetText.slice(1).toLowerCase();
    }
    return targetText;
  }
  // 否则视为整体替换（原样输出编辑词）
  return etext;
}

// ---------------------------------------------------------------------------
// O↔E 对齐：先用「文本完全相同」做锚点，再在间隙内做同类 LCS
//   这样能正确区分「插入的新词」与「被改写的词」，避免把 "X Plan" 误判为 "Plan"→"X"
// ---------------------------------------------------------------------------
function alignTokens(a, b) {
  const usedA = new Set(), usedB = new Set();
  const anchors = [];
  for (let i = 0; i < a.length; i++) {
    if (usedA.has(i)) continue;
    for (let j = 0; j < b.length; j++) {
      if (usedB.has(j)) continue;
      if (a[i].kind === b[j].kind && a[i].text === b[j].text) {
        anchors.push([i, j]); usedA.add(i); usedB.add(j); break;
      }
    }
  }
  anchors.sort((x, y) => x[0] - y[0]);
  const pairs = anchors.slice();
  const aiEdges = [-1, ...anchors.map(a => a[0]), a.length];
  const bjEdges = [-1, ...anchors.map(a => a[1]), b.length];
  for (let s = 0; s < anchors.length + 1; s++) {
    const ga = a.slice(aiEdges[s] + 1, aiEdges[s + 1]);
    const gb = b.slice(bjEdges[s] + 1, bjEdges[s + 1]);
    const sub = lcsAlignment(ga, gb, (x, y) => x.kind === y.kind);
    for (const [si, sj] of sub) pairs.push([aiEdges[s] + 1 + si, bjEdges[s] + 1 + sj]);
  }
  pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return pairs;
}

// ---------------------------------------------------------------------------
// 把编辑模板套用到单个目标文件
// ---------------------------------------------------------------------------
export function applyToTarget(O, E, T, ctx, rng) {
  const pairsOT = lcsAlignment(O, T, (x, y) => x.kind === y.kind);
  const mapOtoT = new Map();
  for (const [oi, ti] of pairsOT) mapOtoT.set(oi, ti);

  const ops = buildOps(O, E, alignTokens(O, E));
  let out = '';
  for (const op of ops) {
    if (op.type === 'delete') continue;
    const et = E[op.bj];
    if (op.type === 'insert') {
      out += et.kind === 'tag' ? evaluateTag(et.inner, ctx, rng) : et.text;
      continue;
    }
    // equal / replace
    const oi = op.ai;
    const ti = mapOtoT.get(oi);
    const targetTok = ti !== undefined ? T[ti] : null;
    if (op.type === 'equal') {
      out += targetTok ? targetTok.text : (et.kind === 'tag' ? evaluateTag(et.inner, ctx, rng) : et.text);
      continue;
    }
    // replace
    if (et.kind === 'tag') {
      out += evaluateTag(et.inner, ctx, rng);
    } else if (et.kind === 'sep') {
      out += et.text;
    } else {
      out += transformWord(et.text, O[oi].text, targetTok ? targetTok.text : null);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 排序
// ---------------------------------------------------------------------------
function sortFiles(files, key, ascending) {
  const arr = files.slice();
  const cmp = (a, b) => {
    let r = 0;
    if (key === 'ctime') r = (a.ctime || 0) - (b.ctime || 0);
    else if (key === 'mtime') r = (a.mtime || 0) - (b.mtime || 0);
    else if (key === 'size') r = (a.size || 0) - (b.size || 0);
    else r = String(a.name).localeCompare(String(b.name));
    return ascending ? r : -r;
  };
  arr.sort(cmp);
  return arr;
}

// ---------------------------------------------------------------------------
// 对外主入口：根据「模板原始名 + 编辑后模板 + 文件列表」计算全部新文件名
//   files:  [{ name, dirParts?: string[], ctime?, mtime?, size? }]
//   options: { sort: 'name'|'ctime'|'mtime'|'size', order: 'asc'|'desc' }
//   返回:    [{ file, original, renamed, relativeKey, warnings: [] }]
// ---------------------------------------------------------------------------
export function computeRenames({ files, templateOriginal, templateEdited, options = {}, rng }) {
  rng = rng || Math.random;
  const sortKey = options.sort || 'name';
  const ascending = options.order !== 'desc';
  const sorted = sortFiles(files, sortKey, ascending);

  const O = tokenize(templateOriginal, false);
  const E = tokenize(templateEdited, true);

  const results = [];
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const ctx = { index: i + 1, total: sorted.length, dirParts: f.dirParts || [] };
    const T = tokenize(f.name, false);
    const renamed = applyToTarget(O, E, T, ctx, rng);
    const warnings = [];
    if (/[:*?"<>]/.test(renamed)) warnings.push('包含 Windows 非法字符（: * ? " < >）');
    results.push({ file: f, original: f.name, renamed, relativeKey: (f.dirParts || []).join('/') + '/' + renamed, warnings });
  }

  // 目标路径冲突检测（含 / 归档到子目录的情形）
  const count = new Map();
  for (const r of results) count.set(r.relativeKey, (count.get(r.relativeKey) || 0) + 1);
  for (const r of results) {
    if (count.get(r.relativeKey) > 1) r.warnings.push('目标路径冲突：与另一个文件重名');
  }
  return results;
}

// ---------------------------------------------------------------------------
// 目标路径解析（纯函数）：把包含 / 或 ../ 的新文件名解析为 { parent, base }
//   parent: 目标父目录的相对层级数组（不含文件名本身）
//   base:   目标文件名
//   用于归档到子目录（Photos/<n>）或上移一级（../x）
// ---------------------------------------------------------------------------
export function resolveTargetPath(file, newName) {
  const tokens = String(newName).split(/[\/\\]+/).filter(Boolean);
  const parts = (file.dirParts || []).slice();
  let base = null;
  for (const t of tokens) {
    if (t === '..') parts.pop();
    else if (t === '.') { /* 当前目录，忽略 */ }
    else { parts.push(t); base = t; }
  }
  const parent = parts.slice(0, parts.length - 1);
  return { parent, base: base ?? String(newName) };
}
