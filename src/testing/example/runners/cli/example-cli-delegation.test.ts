import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DelegationRecord } from '#core/app/index';
import { MemoryLogger } from '#core/testing/index';
import { ExampleApp } from '../assembly/example-app';
import { ExampleDelegationStore } from '../assembly/example-delegation-store';
import { EXIT_REJECTED, EXIT_USAGE, ExampleCli, USAGE } from './example-cli';
import type { CliIo } from './example-cli.types';

// Раннер образца и заявка на делегирование (D-89): `--on-behalf` и
// `--delegation` — обе или ни одной; отказ резолвера — JSON в stdout, код 2.

const PRINCIPAL = '5e3d1c2b-7a6f-4e8d-b9c0-a1f2e3d4c5b6';
const ACTOR = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const T0 = Date.UTC(2026, 9, 1);

const REVOKED: DelegationRecord = {
  delegationId: 'del-1',
  principalId: PRINCIPAL,
  actorId: ACTOR,
  expiresAt: T0 + 60_000,
  revoked: true,
  readOnly: false,
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'example-cli-delegation-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

class BufferIo implements CliIo {
  readonly stdout: string[] = [];
  readonly stderr: string[] = [];
  out(line: string): void {
    this.stdout.push(line);
  }
  err(line: string): void {
    this.stderr.push(line);
  }
}

async function run(...argv: string[]) {
  const app = new ExampleApp(
    { mode: 'test', dataDir: dir, users: [PRINCIPAL, ACTOR] },
    {
      logger: new MemoryLogger(),
      clock: () => T0,
      delegations: new ExampleDelegationStore([REVOKED]),
    },
  );
  const io = new BufferIo();
  const code = await new ExampleCli(app).run(argv, io);
  return { code, io, json: () => JSON.parse(io.stdout.join('\n')) };
}

describe('ExampleCli: делегирование', () => {
  it('отказ резолвера — JSON отказа в stdout и код 2; заявка собрана из опций', async () => {
    const res = await run(
      'list-tasks',
      '--user',
      ACTOR,
      '--on-behalf',
      PRINCIPAL,
      '--delegation',
      'del-1',
    );

    expect(res.code).toBe(EXIT_REJECTED);
    expect(res.json()).toMatchObject({
      ok: false,
      error: { code: 'DELEGATION_DENIED', payload: { reason: 'revoked' } },
    });
    expect(res.io.stderr).toEqual([]);
  });

  it('заявка без --user — invalid (заместитель не назван), код 2', async () => {
    const res = await run(
      'list-tasks',
      '--on-behalf',
      PRINCIPAL,
      '--delegation',
      'del-1',
    );

    expect(res.code).toBe(EXIT_REJECTED);
    expect(res.json()).toMatchObject({
      ok: false,
      error: { code: 'DELEGATION_DENIED', payload: { reason: 'invalid' } },
    });
  });

  it('опция --on-behalf работает у create-task тоже', async () => {
    const res = await run(
      'create-task',
      '--title',
      'Хлеб',
      '--user',
      ACTOR,
      '--on-behalf',
      PRINCIPAL,
      '--delegation',
      'del-1',
    );

    expect(res.code).toBe(EXIT_REJECTED);
    expect(res.json()).toMatchObject({
      error: { code: 'DELEGATION_DENIED' },
    });
  });

  const usage: [string, string[]][] = [
    ['только --on-behalf', ['--on-behalf', PRINCIPAL]],
    ['только --delegation', ['--delegation', 'del-1']],
  ];
  for (const [name, extra] of usage) {
    it(`${name} — ошибка ввода, код 1, UC не вызван`, async () => {
      const res = await run('list-tasks', '--user', ACTOR, ...extra);

      expect(res.code).toBe(EXIT_USAGE);
      expect(res.io.stdout).toEqual([]);
      expect(res.io.stderr.at(-1)).toBe(USAGE);
    });
  }

  it('--on-behalf не uuid — ошибка ввода, код 1', async () => {
    const res = await run(
      'list-tasks',
      '--user',
      ACTOR,
      '--on-behalf',
      'not-a-uuid',
      '--delegation',
      'del-1',
    );

    expect(res.code).toBe(EXIT_USAGE);
    expect(res.io.stdout).toEqual([]);
  });
});
