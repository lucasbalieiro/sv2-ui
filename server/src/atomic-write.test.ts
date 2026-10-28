import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { writeFileAtomically } from './atomic-write.js';
import { createFifo, withUmask } from './test-support.js';

test('writes with the explicitly requested mode under a restrictive umask', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sv2-ui-atomic-'));
  const file = path.join(dir, 'config.toml');
  try {
    await writeFile(file, 'original');
    await chmod(file, 0o644);

    await withUmask(0o077, async () => {
      await writeFileAtomically(file, 'updated', { mode: 0o644 });
    });

    const finalMode = (await stat(file)).mode & 0o777;
    assert.equal(finalMode, 0o644, 'an explicit mode must not be tightened by the umask');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('defaults to owner-only permissions under a permissive umask', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sv2-ui-atomic-'));
  const file = path.join(dir, 'state.json');

  try {
    await withUmask(0o000, async () => {
      await writeFileAtomically(file, 'new file');
    });

    const finalMode = (await stat(file)).mode & 0o777;
    assert.equal(finalMode, 0o600, 'a permissive umask must not widen the default mode');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tightens an existing permissive mode when a restrictive mode is requested', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sv2-ui-atomic-'));
  const file = path.join(dir, 'state.json');
  try {
    await writeFile(file, 'original');
    await chmod(file, 0o644);

    await withUmask(0o077, async () => {
      await writeFileAtomically(file, 'updated', { mode: 0o600 });
    });

    const finalMode = (await stat(file)).mode & 0o777;
    assert.equal(finalMode, 0o600, 'upgraded installs must be migrated to the requested mode');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * Install an ACL whose access is bounded by a mask: the named-user entry
 * forces the mask to rw-, while the owning-group entry denies everything.
 * stat() reports the mask in the group bits, so the file reads 0660 although
 * the owning group has no access to it.
 */
function setRestrictiveAcl(filePath: string): void {
  const entries = `u::rw-,u:${process.getuid!()}:rw-,g::---,m::rw-,o::---`;
  execFileSync('setfacl', ['-m', entries, filePath]);
}

/**
 * The access the owning group really has: its ACL entry narrowed by the mask
 * when one exists, or the plain group bits otherwise. stat() cannot tell a
 * masked 0660 from a group-accessible one.
 */
function owningGroupAccess(filePath: string): number {
  const acl = execFileSync('getfacl', ['-c', '-p', filePath], { encoding: 'utf8' });
  let group: number | undefined;
  let mask: number | undefined;
  for (const line of acl.split('\n')) {
    const entry = /^(group|mask)::([rwx-]{3})/.exec(line);
    if (entry === null) continue;
    const bits = aclBits(entry[2]);
    if (entry[1] === 'group') group = bits;
    else mask = bits;
  }
  if (group === undefined) throw new Error(`getfacl reports no owning-group entry for ${filePath}`);
  return group & (mask ?? 0o7);
}

function aclBits(permissions: string): number {
  return [...permissions].reduce((bits, permission) => {
    if (permission === 'r') return bits | 0o4;
    if (permission === 'w') return bits | 0o2;
    if (permission === 'x') return bits | 0o1;
    return bits;
  }, 0);
}

/**
 * setfacl and getfacl come from the acl package, which minimal Linux images
 * leave out; those environments skip the test instead of failing it.
 */
function hasAclTools(): boolean {
  for (const tool of ['setfacl', 'getfacl']) {
    try {
      execFileSync(tool, ['--version'], { stdio: 'ignore' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  return true;
}

test('replaces an ACL-restricted destination without turning the mask into group access', {
  skip: process.platform !== 'linux',
}, async (t) => {
  if (!hasAclTools()) {
    t.skip('requires setfacl and getfacl');
    return;
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'sv2-ui-atomic-'));
  const file = path.join(dir, 'state.json');
  try {
    await writeFile(file, 'original', { mode: 0o600 });
    setRestrictiveAcl(file);

    // The mask hides in the group bits, and the owning group holds none of it.
    assert.equal((await stat(file)).mode & 0o777, 0o660);
    assert.equal(owningGroupAccess(file), 0);

    await writeFileAtomically(file, 'trusted configuration');

    // The replacement is a fresh inode, so its group bits are real access: a
    // mode derived from the destination's would hand the group the mask's rw.
    assert.equal(
      owningGroupAccess(file),
      0,
      'the replacement must not turn the ACL mask into group access',
    );
    assert.equal(
      (await stat(file)).mode & 0o777,
      0o600,
      'the replacement must not inherit the destination mode',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('replaces a symlink destination instead of writing through it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sv2-ui-atomic-'));
  const attackerFile = path.join(dir, 'attacker-controlled');
  const file = path.join(dir, 'state.json');

  try {
    await writeFile(attackerFile, 'attacker controlled');
    await chmod(attackerFile, 0o666);
    await symlink(attackerFile, file);

    await writeFileAtomically(file, 'trusted configuration', { mode: 0o600 });

    const finalStat = await stat(file);
    assert.ok(finalStat.isFile(), 'the replacement must be a regular file, not a link');
    assert.equal(finalStat.mode & 0o777, 0o600);
    assert.equal(await readFile(attackerFile, 'utf8'), 'attacker controlled', 'the linked target must not be touched');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('replaces a FIFO destination instead of inheriting its mode', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sv2-ui-atomic-'));
  const file = path.join(dir, 'translator.toml');

  try {
    await createFifo(file);

    await writeFileAtomically(file, 'trusted configuration', { mode: 0o600 });

    const finalStat = await stat(file);
    assert.ok(finalStat.isFile(), 'the replacement must be a regular file, not a FIFO');
    assert.equal(finalStat.mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
