// @vitest-environment node
import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import {
  installRequestSqlCounter,
  measureRequestSql,
  withRequestSqlScope,
} from '../../server/providers/request-performance/sql.js';

test('SQL counts isolate concurrent requests and connections and unsubscribe', async () => {
  const client = new EventEmitter();
  const connection = {};
  const other = {};
  const dispose = installRequestSqlCounter(client, connection);
  client.emit('query');
  const counts: number[] = [];
  await Promise.all(
    [1, 3, 7].map((size) =>
      measureRequestSql(
        connection,
        async () => {
          for (let i = 0; i < size; i++) {
            await Promise.resolve();
            client.emit('query');
          }
        },
        (count) => counts.push(count),
      ),
    ),
  );
  expect(counts.sort((a, b) => a - b)).toEqual([1, 3, 7]);
  await measureRequestSql(
    other,
    async () => {
      client.emit('query');
    },
    (count) => expect(count).toBe(0),
  );
  dispose();
  expect(client.listenerCount('query')).toBe(0);
});

test('profiles fixed scopes and identifiers, counts distinct executions without retaining values', async () => {
  const client = new EventEmitter();
  const connection = {};
  const dispose = installRequestSqlCounter(client, connection);
  try {
    await measureRequestSql(
      connection,
      () =>
        withRequestSqlScope('candidate.leave', async () => {
          for (const id of ['private-id', 'private-id', 'second-private-id'])
            client.emit('query', {
              sql: `select 'from private_literal' from "public"."approval_tasks" where id = ? /* join private_comment */`,
              bindings: [id],
            });
        }),
      (count, profile, distinct) => {
        expect(count).toBe(3);
        expect([...profile!]).toEqual([
          [
            JSON.stringify([
              'candidate.leave',
              'select',
              ['public.approval_tasks'],
            ]),
            3,
          ],
        ]);
        expect([...distinct!.values()]).toEqual([2]);
        expect(JSON.stringify([...profile!])).not.toContain('private');
      },
      true,
    );
  } finally {
    dispose();
  }
});

test('failed requests report their count and detached work after completion is excluded', async () => {
  const client = new EventEmitter();
  const connection = {};
  const dispose = installRequestSqlCounter(client, connection);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let detached!: Promise<void>;
  let reported = -1;
  await expect(
    measureRequestSql(
      connection,
      async () => {
        detached = wait.then(() => {
          client.emit('query');
        });
        client.emit('query');
        throw new Error('failure');
      },
      (count) => {
        reported = count;
      },
    ),
  ).rejects.toThrow('failure');
  release();
  await detached;
  expect(reported).toBe(1);
  dispose();
});
