import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { resolve } from 'path'

export function resolvePath(p: string): string {
  return resolve(p.startsWith('~') ? p.replace('~', homedir()) : p)
}

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, stdio: 'pipe' }).toString().trim()
}

export function isGitRepo(dir: string): boolean {
  return existsSync(resolve(dir, '.git'))
}

export function initAndPush(
  localPath: string,
  remoteUrl: string,
  onLog: (msg: string) => void
): void {
  const dir = resolvePath(localPath)

  if (!isGitRepo(dir)) {
    run('git init', dir)
    onLog('git init')
    run('git checkout -b main', dir)
    onLog('branch → main')
  }

  // set or update remote
  try {
    run('git remote add origin ' + remoteUrl, dir)
    onLog('remote added')
  } catch {
    run('git remote set-url origin ' + remoteUrl, dir)
    onLog('remote updated')
  }

  run('git add .', dir)
  onLog('files staged')

  // commit only if there's something to commit
  try {
    run('git diff --cached --quiet', dir)
    onLog('nothing new to commit — skipping')
  } catch {
    run('git commit -m "chore: initial commit via deploymate"', dir)
    onLog('committed')
  }

  run('git push -u origin main --force', dir)
  onLog('pushed to origin/main')
}
