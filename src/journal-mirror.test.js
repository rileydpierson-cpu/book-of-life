import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { JournalMirrorManager } from './journal-mirror.js';

function makeDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bol-journal-mirror-'));
  const localDir = path.join(root, 'local');
  const mirrorDir = path.join(root, 'external');
  const cacheDir = path.join(root, 'cache');
  fs.mkdirSync(localDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  return { root, localDir, mirrorDir, cacheDir };
}

describe('JournalMirrorManager', () => {
  it('continues with local backup when the mirror folder is unavailable', async () => {
    const { localDir, mirrorDir, cacheDir } = makeDirs();
    fs.writeFileSync(path.join(localDir, 'June 4, 2026.md'), 'Local backup');
    const manager = new JournalMirrorManager({ localDir, cacheDir });

    await manager.init(mirrorDir);
    const result = await manager.sync({ reason: 'test' });

    expect(result.skipped).toBe(true);
    expect(manager.getStatus().status).toBe('unavailable');
    expect(manager.getStatus().localDir).toBe(localDir);
  });

  it('mirrors local-only changes outward when the drive reconnects', async () => {
    const { localDir, mirrorDir, cacheDir } = makeDirs();
    fs.writeFileSync(path.join(localDir, 'June 4, 2026.md'), 'Local edit');
    const manager = new JournalMirrorManager({ localDir, cacheDir });
    await manager.init(mirrorDir);

    fs.mkdirSync(mirrorDir, { recursive: true });
    const result = await manager.sync({ reason: 'reconnect' });

    expect(result.externalChanged).toBe(1);
    expect(fs.readFileSync(path.join(mirrorDir, 'June 4, 2026.md'), 'utf8')).toBe('Local edit');
    expect(manager.getStatus().status).toBe('available');
  });

  it('imports external-only changes into the local primary journal', async () => {
    const { localDir, mirrorDir, cacheDir } = makeDirs();
    fs.mkdirSync(mirrorDir, { recursive: true });
    fs.writeFileSync(path.join(mirrorDir, 'June 4, 2026.md'), 'External edit');
    const manager = new JournalMirrorManager({ localDir, cacheDir });

    await manager.init(mirrorDir);
    const result = await manager.sync({ reason: 'external-edit' });

    expect(result.localChanged).toBe(true);
    expect(fs.readFileSync(path.join(localDir, 'June 4, 2026.md'), 'utf8')).toBe('External edit');
  });

  it('keeps both versions when local and external changed', async () => {
    const { localDir, mirrorDir, cacheDir } = makeDirs();
    fs.mkdirSync(mirrorDir, { recursive: true });
    const localFile = path.join(localDir, 'June 4, 2026.md');
    const externalFile = path.join(mirrorDir, 'June 4, 2026.md');
    fs.writeFileSync(localFile, 'Initial');
    fs.writeFileSync(externalFile, 'Initial');
    const manager = new JournalMirrorManager({ localDir, cacheDir });
    await manager.init(mirrorDir);
    await manager.sync({ reason: 'baseline' });

    fs.writeFileSync(localFile, 'Local edit');
    fs.writeFileSync(externalFile, 'External edit');
    const result = await manager.sync({ reason: 'conflict' });

    expect(result.conflicts).toBe(1);
    expect(fs.readFileSync(localFile, 'utf8')).toBe('Local edit');
    expect(fs.readFileSync(externalFile, 'utf8')).toBe('Local edit');
    const conflictFile = fs.readdirSync(localDir).find((fileName) => fileName.includes('External Conflict'));
    expect(conflictFile).toBeTruthy();
    expect(fs.readFileSync(path.join(localDir, conflictFile), 'utf8')).toBe('External edit');
    expect(manager.getStatus().status).toBe('conflict');
  });
});
