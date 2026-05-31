import axios from 'axios'
import tweetsodium from 'tweetsodium'

const api = (token: string) =>
  axios.create({
    baseURL: 'https://api.github.com',
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

async function getRepoPublicKey(token: string, repo: string) {
  const res = await api(token).get(`/repos/${repo}/actions/secrets/public-key`)
  return res.data as { key_id: string; key: string }
}

function encryptSecret(value: string, base64Key: string): string {
  const keyBytes = Buffer.from(base64Key, 'base64')
  const valueBytes = Buffer.from(value)
  const encrypted = tweetsodium.seal(valueBytes, keyBytes)
  return Buffer.from(encrypted).toString('base64')
}

async function putSecret(token: string, repo: string, keyId: string, name: string, value: string, repoKey: string) {
  const encryptedValue = encryptSecret(value, repoKey)
  await api(token).put(`/repos/${repo}/actions/secrets/${name}`, {
    encrypted_value: encryptedValue,
    key_id: keyId,
  })
}

export async function uploadSecrets(
  token: string,
  repo: string,
  secrets: Record<string, string>,
  onLog: (msg: string) => void = () => {}
): Promise<void> {
  const repoKey = await getRepoPublicKey(token, repo)
  onLog(`Got repo encryption key (key_id: ${repoKey.key_id})`)
  await Promise.all(
    Object.entries(secrets).map(async ([name, value]) => {
      await putSecret(token, repo, repoKey.key_id, name, value, repoKey.key)
      onLog(`Secret ${name} uploaded`)
    })
  )
}

export function generateWorkflowYaml(composeFile: string, deployPath: string, repo: string): string {
  return `name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: \${{ secrets.SSH_HOST }}
          username: \${{ secrets.SSH_USER }}
          port: \${{ secrets.SSH_PORT }}
          key: \${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            if [ ! -d "${deployPath}/.git" ]; then
              git clone https://github.com/${repo}.git ${deployPath}
            fi
            cd ${deployPath}
            git fetch origin
            git reset --hard origin/main
            docker compose down || true
            docker compose -f ${composeFile} up -d --build
`
}

export async function commitWorkflow(token: string, repo: string, yamlContent: string): Promise<void> {
  const path = '.github/workflows/deploy.yml'
  const content = Buffer.from(yamlContent).toString('base64')

  let sha: string | undefined
  try {
    const existing = await api(token).get(`/repos/${repo}/contents/${path}`)
    sha = (existing.data as { sha: string }).sha
  } catch {
    // file doesn't exist yet — sha stays undefined
  }

  await api(token).put(`/repos/${repo}/contents/${path}`, {
    message: 'ci: add DeployMate auto-deploy workflow',
    content,
    ...(sha ? { sha } : {}),
  })
}
