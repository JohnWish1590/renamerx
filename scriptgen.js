// scriptgen.js — 生成 PowerShell 重命名脚本（与界面解耦，便于单元测试）
//
// 采用两阶段重命名：先全部移到唯一临时名（避免循环冲突，如 a->b, b->a），
// 再临时名 -> 最终名。可安全处理归档到子目录与任意改名组合。
// 依赖 engine.js 的 resolveTargetPath 把包含 / 或 ../ 的新文件名解析为相对路径。

import { resolveTargetPath } from './engine.js';

export function buildPowerShellScript(results, rootName, opts = {}) {
  const winPath = p => p.replace(/\//g, '\\');
  const ps = s => "'" + String(s).replace(/'/g, "''") + "'";
  // tmp 名生成器可注入，便于测试确定性
  const tmpFn = opts.tmpFn || (i => '.renx_tmp_' + i + '_' + Math.random().toString(16).slice(2, 8));

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
    const tmp = (targetDir ? targetDir + '/' : '') + tmpFn(i);
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
  // 前置 UTF-8 BOM：PowerShell 在中文系统默认按系统代码页（GBK）读取 .ps1，
  // 无 BOM 的 UTF-8 中文会被解析错误导致脚本损坏，故必须加 BOM。
  return '﻿' + lines.join('\r\n');
}
