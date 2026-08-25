import { access, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withFileLock, writeFileAtomic } from '../src/index.ts'

const state = vi.hoisted(() => ({ failLockCreateWithEPERM: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: (async (path: unknown, ...rest: never[]) => {
      if (state.failLockCreateWithEPERM && String(path).endsWith('.lock')) {
        state.failLockCreateWithEPERM = false
        throw Object.assign(new Error('EPERM: injected exclusive-create failure'), { code: 'EPERM' })
      }
      return (actual.writeFile as (path: unknown, ...args: never[]) => Promise<void>)(path, ...rest)
    }) as typeof actual.writeFile,
  }
})

afterEach(() => {
  state.failLockCreateWithEPERM = false
})

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-atomic-write-'))
}

describe('writeFileAtomic', () => {
  it('creates the file and its parents with exactly the stated mode', async () => {
    const dir = await scratch()
    const target = join(dir, 'nested', 'deep', 'doc.yaml')
    await writeFileAtomic(target, 'a: 1\n', { mode: 0o600 })
    expect(await readFile(target, 'utf8')).toBe('a: 1\n')
    if (process.platform !== 'win32') expect((await stat(target)).mode & 0o777).toBe(0o600)
  })

  it('replaces existing content and narrows a wider-permission file to the stated mode', async () => {
    const dir = await scratch()
    const target = join(dir, 'doc.yaml')
    await writeFile(target, 'old', { mode: 0o644 })
    await writeFileAtomic(target, 'new', { mode: 0o600 })
    expect(await readFile(target, 'utf8')).toBe('new')
    if (process.platform !== 'win32') expect((await stat(target)).mode & 0o777).toBe(0o600)
  })

  it('replaces a symlinked target itself without writing through to the referent', async () => {
    const dir = await scratch()
    const victim = join(dir, 'victim')
    await writeFile(victim, 'victim-content')
    const target = join(dir, 'doc.yaml')
    await symlink(victim, target)
    await writeFileAtomic(target, 'replaced', { mode: 0o600 })
    expect((await lstat(target)).isSymbolicLink()).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('replaced')
    expect(await readFile(victim, 'utf8')).toBe('victim-content')
  })

  it('leaves no temp sibling and rethrows when the rename fails', async () => {
    const dir = await scratch()
    const target = join(dir, 'occupied')
    await mkdir(target)
    await expect(writeFileAtomic(target, 'content', { mode: 0o600 })).rejects.toThrow()
    expect((await readdir(dir)).filter(entry => entry.includes('.tmp'))).toEqual([])
  })
})

describe('withFileLock', () => {
  it('retries EPERM only when the lock path currently exists', async () => {
    const dir = await scratch()
    const target = join(dir, 'document')
    const lockPath = `${target}.lock`
    await writeFile(lockPath, 'holder\n')
    const release = setTimeout(() => { void rm(lockPath, { force: true }) }, 50)
    state.failLockCreateWithEPERM = true
    let called = false

    try {
      await withFileLock(target, async () => { called = true })
    } finally {
      clearTimeout(release)
    }
    expect(called).toBe(true)
  })

  it('preserves EPERM when no lock path exists', async () => {
    const dir = await scratch()
    const operation = vi.fn(async () => {})
    state.failLockCreateWithEPERM = true

    await expect(withFileLock(join(dir, 'document'), operation)).rejects.toMatchObject({ code: 'EPERM' })
    expect(operation).not.toHaveBeenCalled()
  })

  it('rejects an invalid parent hierarchy before running the operation', async () => {
    const dir = await scratch()
    const parent = join(dir, 'not-a-directory')
    await writeFile(parent, 'occupied')
    let called = false

    await expect(withFileLock(join(parent, 'document'), async () => {
      called = true
    })).rejects.toThrow(/ENOENT|ENOTDIR|not a directory/i)
    expect(called).toBe(false)
  })

  it('recovers a lock whose recorded owner is dead instead of timing out', async () => {
    const dir = await scratch()
    const target = join(dir, 'document')
    const lockPath = `${target}.lock`
    // A child that has already exited is a provably dead owner PID.
    const deadPid = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', ''])
      child.on('spawn', () => {
        child.on('exit', () => resolve(child.pid ?? -1))
        child.on('error', reject)
      })
    })
    expect(deadPid).toBeGreaterThan(0)
    await writeFile(lockPath, `${deadPid}\n`)

    let called = false
    await withFileLock(target, async () => { called = true })
    expect(called).toBe(true)
    await expect(access(lockPath)).rejects.toThrow()
  })

  it('never steals a lock whose recorded owner is still alive', async () => {
    const dir = await scratch()
    const target = join(dir, 'document')
    const lockPath = `${target}.lock`
    await writeFile(lockPath, `${process.pid}\n`)

    await expect(withFileLock(target, async () => {})).rejects.toThrow(/timed out waiting for the writer lock/)
    expect(await readFile(lockPath, 'utf8')).toBe(`${process.pid}\n`)
  }, 10_000)
})
