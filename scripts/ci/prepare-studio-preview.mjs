import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

// The release template initializes new PR Apps; existing App configuration is retained by Studio.
assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request');
const file = 'config.example.yml';
const source = readFileSync(file, 'utf8');
const connection =
  /(^database:\n  default: main\n  connections:\n    main:\n)      dialect: postgres\n      host: [^\n]+\n      port: [^\n]+\n      database: [^\n]+\n      username: [^\n]+\n      password: [^\n]+\n/m;
assert(
  connection.test(source),
  'Review the changed database template before preparing a SQLite preview',
);
writeFileSync(
  file,
  source.replace(
    connection,
    '$1      dialect: sqlite\n      database: database.sqlite\n',
  ),
);
console.log('PR release template uses SQLite in the App storage directory.');
