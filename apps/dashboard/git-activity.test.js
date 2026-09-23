const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { inspectProjectGitActivity } = require('./git-activity');

function git(directory, arguments_) {
  return execFileSync('git', ['-C', directory, ...arguments_], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function fixture(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tracking-git-'));
  try { return callback(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function createRepository(directory) {
  git(directory, ['init']);
  git(directory, ['config', 'user.name', 'Tracker test']);
  git(directory, ['config', 'user.email', 'tracker@example.invalid']);
  fs.writeFileSync(path.join(directory, 'tracked.txt'), 'initial\n');
  git(directory, ['add', 'tracked.txt']);
  git(directory, ['commit', '-m', 'initial']);
}

function addLocalRemoteAndPush(directory) {
  const remote = path.join(directory, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(directory, ['remote', 'add', 'origin', remote]);
  git(directory, ['push', '--set-upstream', 'origin', 'HEAD']);
}

test('inspects clean local Git activity without exposing repository paths or commit content', () => fixture((directory) => {
  createRepository(directory);
  const overview = inspectProjectGitActivity({ name: 'Fixture', paths: [directory] });
  assert.equal(overview.project.name, 'Fixture');
  assert.equal(overview.localFiles.state, 'clean');
  assert.match(overview.localFiles.latestModificationAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(overview.commit.state, 'available');
  assert.match(overview.commit.shortCommitId, /^[0-9a-f]{7,40}$/i);
  assert.equal(overview.push.state, 'unavailable');
  assert.equal(overview.remoteRelationship.state, 'unavailable');
  assert.equal(JSON.stringify(overview).includes(directory), false);
  assert.equal(JSON.stringify(overview).includes('initial'), false);
}));

test('reports non-ignored untracked work in local workspace state and excludes ignored files', () => fixture((directory) => {
  createRepository(directory);
  fs.writeFileSync(path.join(directory, '.gitignore'), 'ignored.txt\n');
  git(directory, ['add', '.gitignore']);
  git(directory, ['commit', '-m', 'ignore local artifacts']);
  fs.writeFileSync(path.join(directory, 'ignored.txt'), 'not tracked\n');
  let overview = inspectProjectGitActivity({ name: 'Fixture', paths: [directory] });
  assert.equal(overview.localFiles.state, 'clean');
  fs.writeFileSync(path.join(directory, 'untracked.txt'), 'local work\n');
  fs.utimesSync(path.join(directory, 'untracked.txt'), new Date('2030-01-02T03:04:05.000Z'), new Date('2030-01-02T03:04:05.000Z'));
  overview = inspectProjectGitActivity({ name: 'Fixture', paths: [directory] });
  assert.equal(overview.localFiles.state, 'modified');
  assert.equal(overview.localFiles.latestModificationAt, '2030-01-02T03:04:05.000Z');
  assert.equal(JSON.stringify(overview).includes('untracked.txt'), false);
  assert.equal(JSON.stringify(overview).includes('ignored.txt'), false);
  fs.writeFileSync(path.join(directory, 'tracked.txt'), 'changed\n');
  overview = inspectProjectGitActivity({ name: 'Fixture', paths: [directory] });
  assert.equal(overview.localFiles.state, 'modified');
  assert.match(overview.localFiles.latestModificationAt, /^\d{4}-\d{2}-\d{2}T/);
}));

test('reports a non-Git registered path honestly as unavailable', () => fixture((directory) => {
  const overview = inspectProjectGitActivity({ name: 'No repository', paths: [directory] });
  assert.deepEqual(overview, {
    project: { name: 'No repository' },
    localFiles: { state: 'unavailable', reason: 'not_git_repository' },
    commit: { state: 'unavailable', reason: 'not_git_repository' },
    push: { state: 'unavailable', reason: 'not_git_repository' },
    remoteRelationship: { state: 'unavailable', reason: 'not_git_repository' },
  });
}));

test('reports an explicit local push reflog record but does not treat commit time as push evidence', () => fixture((directory) => {
  createRepository(directory);
  addLocalRemoteAndPush(directory);
  git(directory, ['update-ref', '--create-reflog', '-m', 'update by push', 'refs/remotes/origin/push-proof', 'HEAD']);
  const overview = inspectProjectGitActivity({ name: 'Fixture', paths: [directory] });
  assert.equal(overview.push.state, 'available');
  assert.equal(overview.push.evidence, 'local_git_reflog');
  assert.match(overview.push.pushedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(overview.remoteRelationship.state, 'up_to_date');
  assert.equal(overview.remoteRelationship.evidence, 'local_git_knowledge');
}));

test('reports the locally known ahead/behind relationship only when an upstream is configured', () => fixture((directory) => {
  createRepository(directory);
  addLocalRemoteAndPush(directory);
  const overview = inspectProjectGitActivity({ name: 'Fixture', paths: [directory] });
  assert.deepEqual(overview.remoteRelationship, { state: 'up_to_date', ahead: 0, behind: 0, evidence: 'local_git_knowledge' });
}));
