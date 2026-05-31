#!/usr/bin/env node
import * as p from '@clack/prompts'
import chalk from 'chalk'
import gradient from 'gradient-string'
import { generateKeyPair, uploadPublicKey, type SshAuth } from './services/ssh.js'
import {
  getAuthenticatedUser,
  repoExists,
  createRepo,
  uploadSecrets,
  generateWorkflowYaml,
  commitWorkflow,
} from './services/github.js'
import { initAndPush, resolvePath } from './services/git.js'

// ─── Banner ───────────────────────────────────────────────────────────────────

const ASCII = [
  '  ██████╗ ███████╗██████╗ ██╗      ██████╗ ██╗   ██╗███╗   ███╗ █████╗ ████████╗███████╗',
  '  ██╔══██╗██╔════╝██╔══██╗██║     ██╔═══██╗╚██╗ ██╔╝████╗ ████║██╔══██╗╚══██╔══╝██╔════╝',
  '  ██║  ██║█████╗  ██████╔╝██║     ██║   ██║ ╚████╔╝ ██╔████╔██║███████║   ██║   █████╗  ',
  '  ██║  ██║██╔══╝  ██╔═══╝ ██║     ██║   ██║  ╚██╔╝  ██║╚██╔╝██║██╔══██║   ██║   ██╔══╝  ',
  '  ██████╔╝███████╗██║     ███████╗╚██████╔╝   ██║   ██║ ╚═╝ ██║██║  ██║   ██║   ███████╗',
  '  ╚═════╝ ╚══════╝╚═╝     ╚══════╝ ╚═════╝    ╚═╝   ╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝',
].join('\n')

console.log()
console.log(gradient(['#3b82f6', '#8b5cf6']).multiline(ASCII))
console.log()
console.log(chalk.dim('  Docker CI/CD on any VPS in one command  ·  ') + chalk.bold('Benyamin Rmb'))
console.log(chalk.dim('  ☕  ') + chalk.dim.underline('https://reymit.ir/benyaminrmb'))
console.log()

p.intro(chalk.bgBlue.white.bold('  deploymate  ') + chalk.dim('  v1.0.0'))

// ─── SSH ──────────────────────────────────────────────────────────────────────

const ssh = await p.group(
  {
    host: () =>
      p.text({
        message: 'SSH host',
        placeholder: '1.2.3.4 or example.com',
        validate: (v) => (!v ? 'Host is required' : undefined),
      }),

    port: () =>
      p.text({
        message: 'SSH port',
        initialValue: '22',
        validate: (v) => (isNaN(Number(v)) ? 'Must be a number' : undefined),
      }),

    username: () =>
      p.text({
        message: 'Username',
        initialValue: 'root',
        validate: (v) => (!v ? 'Username is required' : undefined),
      }),

    authMethod: () =>
      p.select<{ value: 'password' | 'key'; label: string; hint: string }[], 'password' | 'key'>({
        message: 'Authentication',
        options: [
          { value: 'password', label: 'Password',     hint: 'used once to bootstrap key-based auth' },
          { value: 'key',      label: 'SSH key file', hint: 'path to your existing private key' },
        ],
      }),

    password: ({ results }) =>
      results.authMethod === 'password'
        ? p.password({
            message: 'Password',
            validate: (v) => (!v ? 'Password is required' : undefined),
          })
        : Promise.resolve(undefined),

    keyPath: ({ results }) =>
      results.authMethod === 'key'
        ? p.text({
            message: 'Private key path',
            initialValue: '~/.ssh/id_rsa',
            validate: (v) => (!v ? 'Key path is required' : undefined),
          })
        : Promise.resolve(undefined),
  },
  { onCancel: () => { p.cancel('Cancelled.'); process.exit(0) } }
)

// ─── GitHub ───────────────────────────────────────────────────────────────────

console.log()

const { token } = await p.group(
  {
    token: () =>
      p.password({
        message: 'GitHub personal access token',
        validate: (v) => {
          if (!v) return 'Token is required'
          if (!v.startsWith('ghp_') && !v.startsWith('github_pat_'))
            return 'Token should start with ghp_ or github_pat_'
        },
      }),
  },
  { onCancel: () => { p.cancel('Cancelled.'); process.exit(0) } }
)

// ─── Repo ─────────────────────────────────────────────────────────────────────

const repoMode = await p.select<{ value: 'existing' | 'create'; label: string; hint: string }[], 'existing' | 'create'>({
  message: 'Repository',
  options: [
    { value: 'existing', label: 'Use existing repo', hint: 'owner/repo' },
    { value: 'create',   label: 'Create new repo',   hint: "I'll init git and push for you" },
  ],
})
if (p.isCancel(repoMode)) { p.cancel('Cancelled.'); process.exit(0) }

let fullRepo: string
let localPath: string | undefined

if (repoMode === 'existing') {
  const { repo } = await p.group(
    {
      repo: () =>
        p.text({
          message: 'Repository (owner/repo)',
          placeholder: 'myname/myrepo',
          validate: (v) => {
            if (!v) return 'Repo is required'
            if (!v.includes('/')) return 'Format must be owner/repo'
          },
        }),
    },
    { onCancel: () => { p.cancel('Cancelled.'); process.exit(0) } }
  )
  fullRepo = repo
} else {
  const newRepo = await p.group(
    {
      name: () =>
        p.text({
          message: 'Repository name',
          placeholder: 'my-app',
          validate: (v) => (!v ? 'Name is required' : undefined),
        }),

      description: () =>
        p.text({
          message: 'Description',
          placeholder: 'optional',
        }),

      visibility: () =>
        p.select<{ value: 'public' | 'private'; label: string }[], 'public' | 'private'>({
          message: 'Visibility',
          options: [
            { value: 'public',  label: 'Public' },
            { value: 'private', label: 'Private' },
          ],
        }),

      localPath: () =>
        p.text({
          message: 'Local project path',
          placeholder: '~/projects/my-docker-app',
          validate: (v) => (!v ? 'Path is required' : undefined),
        }),
    },
    { onCancel: () => { p.cancel('Cancelled.'); process.exit(0) } }
  )

  const s = p.spinner()
  s.start('Fetching GitHub user…')
  let owner: string
  try {
    owner = await getAuthenticatedUser(token)
    s.stop(chalk.green('✓') + `  Signed in as ${chalk.bold(owner)}`)
  } catch (err) {
    s.stop(chalk.red('✗') + '  Failed to fetch GitHub user')
    p.log.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  fullRepo = `${owner}/${newRepo.name}`
  localPath = newRepo.localPath

  const exists = await repoExists(token, fullRepo)
  if (exists) {
    p.log.warn(`Repo ${chalk.bold(fullRepo)} already exists — will use it`)
  } else {
    const s2 = p.spinner()
    s2.start(`Creating ${chalk.bold(fullRepo)}…`)
    try {
      await createRepo(token, newRepo.name, newRepo.description ?? '', newRepo.visibility === 'private')
      s2.stop(chalk.green('✓') + `  Created ${chalk.underline(`https://github.com/${fullRepo}`)}`)
    } catch (err) {
      s2.stop(chalk.red('✗') + '  Failed to create repo')
      p.log.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  }
}

// ─── Deploy config ────────────────────────────────────────────────────────────

console.log()

const deploy = await p.group(
  {
    deployPath: () =>
      p.text({
        message: 'Deploy path on server',
        initialValue: `/opt/${fullRepo.split('/')[1]}`,
      }),

    composeFile: () =>
      p.text({
        message: 'Docker Compose file',
        initialValue: 'docker-compose.yml',
      }),
  },
  { onCancel: () => { p.cancel('Cancelled.'); process.exit(0) } }
)

// ─── Confirmation ─────────────────────────────────────────────────────────────

console.log()
p.log.info(
  chalk.bold('Summary\n') +
  `  ${chalk.dim('Server')}   ${ssh.host}:${ssh.port} (${ssh.username})\n` +
  `  ${chalk.dim('Auth')}     ${ssh.authMethod === 'password' ? 'password' : ssh.keyPath}\n` +
  `  ${chalk.dim('Repo')}     github.com/${fullRepo}\n` +
  (localPath ? `  ${chalk.dim('Local')}    ${localPath}\n` : '') +
  `  ${chalk.dim('Path')}     ${deploy.deployPath}\n` +
  `  ${chalk.dim('Compose')}  ${deploy.composeFile}`
)
console.log()

const confirmed = await p.confirm({ message: 'Proceed?' })
if (!confirmed || p.isCancel(confirmed)) { p.cancel('Aborted.'); process.exit(0) }

// ─── Execution ────────────────────────────────────────────────────────────────

console.log()

const step = async (label: string, fn: (log: (m: string) => void) => Promise<void>) => {
  const s = p.spinner()
  s.start(label)
  const logs: string[] = []
  try {
    await fn((msg) => { logs.push(msg); s.message(`${label} ${chalk.dim('— ' + msg)}`) })
    s.stop(chalk.green('✓') + '  ' + label)
  } catch (err) {
    s.stop(chalk.red('✗') + '  ' + label)
    for (const l of logs) p.log.error(chalk.dim(l))
    throw err
  }
}

try {
  if (localPath) {
    await step('Pushing project to GitHub', (log) => {
      initAndPush(resolvePath(localPath!), `https://github.com/${fullRepo}.git`, log)
      return Promise.resolve()
    })
  }

  let privateKey = ''
  let publicKey = ''

  await step('Generating RSA key pair', async () => {
    const kp = generateKeyPair()
    privateKey = kp.privateKey
    publicKey = kp.publicKey
  })

  const auth: SshAuth =
    ssh.authMethod === 'password'
      ? { type: 'password', password: ssh.password as string }
      : { type: 'key', keyPath: ssh.keyPath as string }

  await step('Uploading public key to server', (log) =>
    uploadPublicKey(ssh.host, Number(ssh.port), ssh.username, auth, publicKey, log)
  )

  await step('Injecting GitHub secrets', (log) =>
    uploadSecrets(token, fullRepo, {
      SSH_PRIVATE_KEY: privateKey,
      SSH_HOST: ssh.host,
      SSH_PORT: ssh.port,
      SSH_USER: ssh.username,
      GH_TOKEN: token,
    }, log)
  )

  await step('Committing deploy.yml to repo', async () => {
    const yaml = generateWorkflowYaml(deploy.composeFile, deploy.deployPath, fullRepo)
    await commitWorkflow(token, fullRepo, yaml)
  })

  console.log()
  p.outro(
    chalk.green('✓') + chalk.bold('  All done! CI/CD is live.\n\n') +
    `  ${chalk.dim('Actions')}  ${chalk.underline(`https://github.com/${fullRepo}/actions`)}\n\n` +
    chalk.dim('  Made with ❤️  by Benyamin Rmb  ·  ') +
    chalk.dim.underline('https://reymit.ir/benyaminrmb')
  )

} catch (err) {
  console.log()
  p.log.error(chalk.bold('Deploy failed'))
  p.log.error(err instanceof Error ? err.message : String(err))
  console.log()
  process.exit(1)
}
