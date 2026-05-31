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

export async function getAuthenticatedUser(token: string): Promise<string> {
  const res = await api(token).get('/user')
  return (res.data as { login: string }).login
}

export async function repoExists(token: string, repo: string): Promise<boolean> {
  try {
    await api(token).get(`/repos/${repo}`)
    return true
  } catch {
    return false
  }
}

export async function createRepo(
  token: string,
  name: string,
  description: string,
  isPrivate: boolean
): Promise<{ fullName: string; cloneUrl: string }> {
  const res = await api(token).post('/user/repos', {
    name,
    description,
    private: isPrivate,
    auto_init: false,
  })
  const data = res.data as { full_name: string; clone_url: string }
  return { fullName: data.full_name, cloneUrl: data.clone_url }
}

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
  await api(token).put(`/repos/${repo}/actions/secrets/${name}`, {
    encrypted_value: encryptSecret(value, repoKey),
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
  onLog(`Repo encryption key fetched`)
  for (const [name, value] of Object.entries(secrets)) {
    await putSecret(token, repo, repoKey.key_id, name, value, repoKey.key)
    onLog(`  ${name}`)
  }
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
          envs: GH_TOKEN
          script: |
            REPO_URL="https://x-access-token:\${GH_TOKEN}@github.com/${repo}.git"
            if [ ! -d "${deployPath}/.git" ]; then
              git clone "\${REPO_URL}" ${deployPath}
            fi
            cd ${deployPath}
            git fetch "\${REPO_URL}"
            git reset --hard origin/main
            docker compose down || true
            docker compose -f ${composeFile} up -d --build
        env:
          GH_TOKEN: \${{ secrets.GH_TOKEN }}
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
    // file doesn't exist yet
  }

  await api(token).put(`/repos/${repo}/contents/${path}`, {
    message: 'ci: add DeployMate auto-deploy workflow',
    content,
    ...(sha ? { sha } : {}),
  })
}
