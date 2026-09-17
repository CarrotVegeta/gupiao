/**
 * 跨平台清理构建产物。原来的 `rm -rf dist-server` 在 Windows 上直接失败。
 *
 * 安全约束：只允许删除「解析后等于 <项目根>/dist-server」的目录。
 * 路径不符合预期时直接退出而不是硬删，避免把别的目录删掉。
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(projectRoot, 'dist-server');
const expected = path.join(projectRoot, 'dist-server');

if (target !== expected) {
  console.error(`[clean] 目标路径不是项目的 dist-server，已跳过：${target}`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
console.log(`[clean] 已清理 ${path.relative(projectRoot, target)}`);
