const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function unavailable(reason) { return { state: 'unavailable', reason }; }

function resolvedRepositoryPath(repositoryPath) {
  if (typeof repositoryPath !== 'string' || !repositoryPath.trim()) return null;
  try {
    // Resolve links before both the Git working directory and safe.directory
    // value are built. This produces one exact, local path for this command;
    // it never changes Git's user or system configuration.
    return fs.realpathSync.native(repositoryPath);
  } catch {
    return null;
  }
}

function runGit(repositoryPath, arguments_, { execFile = execFileSync } = {}) {
  const resolvedPath = resolvedRepositoryPath(repositoryPath);
  if (!resolvedPath) return { ok: false, output: '' };
  try {
    return {
      ok: true,
      output: execFile('git', [
        // Some registered OneDrive repositories are owned by a different
        // Windows identity. Allow only this resolved repository for this one
        // read-only Git invocation; do not persist a Git configuration value.
        '-c', `safe.directory=${resolvedPath}`,
        '--no-optional-locks', '-C', resolvedPath, ...arguments_,
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
    };
  } catch {
    return { ok: false, output: '' };
  }
}

function isRepository(repositoryPath, git = runGit) {
  return git(repositoryPath, ['rev-parse', '--is-inside-work-tree']).output.trim() === 'true';
}

function safeIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function latestWorkspaceFileModification(repositoryPath, git = runGit) {
  // `ls-files --others --exclude-standard` includes only non-ignored files.
  // Paths are used transiently to read timestamps and never leave this module.
  const trackedFiles = git(repositoryPath, ['ls-files', '-z']);
  const untrackedFiles = git(repositoryPath, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (!trackedFiles.ok || !untrackedFiles.ok) return unavailable('git_unavailable');
  let newest = null;
  for (const relativePath of [...trackedFiles.output.split('\0'), ...untrackedFiles.output.split('\0')]) {
    if (!relativePath) continue;
    const candidate = path.resolve(repositoryPath, relativePath);
    const root = `${path.resolve(repositoryPath)}${path.sep}`;
    if (!candidate.startsWith(root)) continue;
    try {
      const stat = fs.lstatSync(candidate);
      if (!newest || stat.mtimeMs > newest) newest = stat.mtimeMs;
    } catch {
      // A tracked deleted file has no local modification timestamp. It is still
      // reflected in the independently calculated working-tree state below.
    }
  }
  const status = git(repositoryPath, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (!status.ok) return unavailable('git_unavailable');
  return {
    state: status.output ? 'modified' : 'clean',
    latestModificationAt: newest == null ? null : new Date(newest).toISOString(),
  };
}

function latestLocalCommit(repositoryPath, git = runGit) {
  const result = git(repositoryPath, ['log', '-1', '--format=%cI%x1f%h']);
  if (!result.ok || !result.output.trim()) return unavailable('no_local_commit');
  const [recordedAt, shortId] = result.output.trim().split('\x1f');
  const commitAt = safeIso(recordedAt);
  if (!commitAt || !/^[0-9a-f]{7,40}$/i.test(shortId || '')) return unavailable('no_local_commit');
  return { state: 'available', committedAt: commitAt, shortCommitId: shortId };
}

function latestLocallyRecordedPush(repositoryPath, git = runGit) {
  const result = git(repositoryPath, ['reflog', 'show', '--all', '--date=iso-strict', '--format=%gs%x1f%gd']);
  if (!result.ok) return unavailable('no_local_push_evidence');
  const entries = result.output.split(/\r?\n/);
  for (const entry of entries) {
    const [message, selector] = entry.split('\x1f');
    if (message?.trim().toLowerCase() !== 'update by push') continue;
    const pushedAt = safeIso(selector?.match(/@\{(.+)\}$/)?.[1]);
    if (pushedAt) return { state: 'available', pushedAt, evidence: 'local_git_reflog' };
  }
  return unavailable('no_local_push_evidence');
}

function localRemoteRelationship(repositoryPath, git = runGit) {
  const upstream = git(repositoryPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (!upstream.ok || !upstream.output.trim()) return unavailable('no_upstream');
  const counts = git(repositoryPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (!counts.ok) return unavailable('relationship_unavailable');
  const [aheadText, behindText] = counts.output.trim().split(/\s+/);
  const ahead = Number(aheadText);
  const behind = Number(behindText);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind) || ahead < 0 || behind < 0) return unavailable('relationship_unavailable');
  const state = ahead === 0 && behind === 0 ? 'up_to_date' : ahead > 0 && behind === 0 ? 'ahead' : ahead === 0 && behind > 0 ? 'behind' : 'diverged';
  return { state, ahead, behind, evidence: 'local_git_knowledge' };
}

function unavailableProjectOverview(project, reason) {
  return {
    project: { name: project.name },
    localFiles: unavailable(reason),
    commit: unavailable(reason),
    push: unavailable(reason),
    remoteRelationship: unavailable(reason),
  };
}

function inspectProjectGitActivity(project, { git = runGit } = {}) {
  if (!project || typeof project.name !== 'string' || !Array.isArray(project.paths) || !project.paths.length) return unavailableProjectOverview(project || { name: 'Unknown project' }, 'repository_not_configured');
  const repositoryPath = project.paths
    .map(resolvedRepositoryPath)
    .find((candidate) => candidate && isRepository(candidate, git));
  if (!repositoryPath) return unavailableProjectOverview(project, 'not_git_repository');
  return {
    project: { name: project.name },
    localFiles: latestWorkspaceFileModification(repositoryPath, git),
    commit: latestLocalCommit(repositoryPath, git),
    push: latestLocallyRecordedPush(repositoryPath, git),
    remoteRelationship: localRemoteRelationship(repositoryPath, git),
  };
}

function inspectRegisteredProjectGitActivity(projects, options) {
  return { projects: Array.isArray(projects) ? projects.map((project) => inspectProjectGitActivity(project, options)) : [] };
}

module.exports = {
  inspectProjectGitActivity,
  inspectRegisteredProjectGitActivity,
  latestLocalCommit,
  latestLocallyRecordedPush,
  latestWorkspaceFileModification,
  localRemoteRelationship,
  resolvedRepositoryPath,
  runGit,
};
