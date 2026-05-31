import { Router, Request, Response } from 'express'
import { generateKeyPair, uploadPublicKey } from '../services/sshService.js'
import { uploadSecrets, generateWorkflowYaml, commitWorkflow } from '../services/githubService.js'

const router = Router()

function send(res: Response, step: { id: string; label: string; status: 'running' | 'done' | 'error'; error?: string }) {
  res.write(`data: ${JSON.stringify(step)}\n\n`)
}

function log(res: Response, message: string) {
  res.write(`data: ${JSON.stringify({ id: 'log', label: message, status: 'log' })}\n\n`)
}

router.post('/deploy', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const { ssh, github, deployPath = '/opt/app', composeFile = 'docker-compose.yml' } = req.body

  try {
    // Step 1: generate key pair
    send(res, { id: 'keygen', label: 'Generating SSH key pair…', status: 'running' })
    const { publicKey, privateKey } = generateKeyPair()
    send(res, { id: 'keygen', label: 'SSH key pair generated', status: 'done' })

    // Step 2: upload public key to server
    send(res, { id: 'ssh-upload', label: 'Uploading public key to server…', status: 'running' })
    await uploadPublicKey(ssh.host, ssh.port ?? 22, ssh.username, ssh.password, publicKey, (msg) => log(res, msg))
    send(res, { id: 'ssh-upload', label: 'Public key uploaded to server', status: 'done' })

    // Step 3: inject GitHub secrets
    send(res, { id: 'gh-secrets', label: 'Injecting GitHub secrets…', status: 'running' })
    log(res, `Fetching repo public key for ${github.repo}…`)
    await uploadSecrets(github.token, github.repo, {
      SSH_PRIVATE_KEY: privateKey,
      SSH_HOST: ssh.host,
      SSH_PORT: String(ssh.port ?? 22),
      SSH_USER: ssh.username,
    }, (msg) => log(res, msg))
    send(res, { id: 'gh-secrets', label: '4 GitHub secrets injected', status: 'done' })

    // Step 4: commit workflow file
    send(res, { id: 'workflow', label: 'Committing deploy.yml to repo…', status: 'running' })
    log(res, 'Checking for existing deploy.yml…')
    const yaml = generateWorkflowYaml(composeFile, deployPath, github.repo)
    await commitWorkflow(github.token, github.repo, yaml)
    send(res, { id: 'workflow', label: 'deploy.yml committed to .github/workflows/', status: 'done' })

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
  } finally {
    res.end()
  }
})

export default router
