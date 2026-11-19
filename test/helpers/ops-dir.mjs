// 测试共用：把锁目录（MAITIAN_OPS_DIR）指到临时目录，不往仓库的 data/ops 写。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MAITIAN_OPS_DIR = mkdtempSync(join(tmpdir(), 'maitian-ops-'));
export const OPS_DIR = process.env.MAITIAN_OPS_DIR;
export const LOCKS_DIR = join(OPS_DIR, 'locks');
