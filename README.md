# DeployMate

**Zero-config Docker CI/CD — SSH key setup + GitHub Actions in one command.**

No YAML writing. No manual secret configuration. No SSH key management.  
Fill in 5 fields, press Enter, and every push to `main` auto-deploys to your server.

```
npx deploymate-cli
```

---

## The problem

Setting up CI/CD on a VPS the normal way takes 15+ minutes:

1. Generate an SSH key pair locally
2. Copy the public key to the server (`~/.ssh/authorized_keys`)
3. Go to GitHub → Settings → Secrets → add `SSH_KEY`, `SSH_HOST`, `SSH_PORT`, `SSH_USER` one by one
4. Write a `deploy.yml` GitHub Actions workflow file from scratch
5. Commit, push, debug

DeployMate does all of this in one interactive command.

---

## Demo

```
┌  deploymate  v1.0.0
│
◇  SSH host
│  1.2.3.4
│
◇  SSH port
│  9011
│
◇  Username
│  root
│
◆  Authentication
│  ● Password  (used once to bootstrap key-based auth)
│
◇  Password
│  ••••••••••••
│
◇  GitHub personal access token
│  ••••••••••••••••••••••••••••••••••••
│
◆  Repository
│  ● Create new repo  (I'll init git and push for you)
│
◇  Repository name
│  my-app
│
◇  Local project path
│  ~/projects/my-app
│
◇  Deploy path on server
│  /opt/my-app
│
  Summary
  Server   1.2.3.4:9011 (root)
  Repo     github.com/yourname/my-app
  Path     /opt/my-app

◇  Proceed? Yes

✓  Pushing project to GitHub
✓  Generating RSA key pair
✓  Uploading public key to server
✓  Injecting GitHub secrets
✓  Committing deploy.yml to repo

└  ✓ All done! CI/CD is live.
   Actions  https://github.com/yourname/my-app/actions
```

---

## What it does

1. **Generates an RSA key pair** in memory — never written to disk
2. **SSHes into your server** using your password (once)
3. **Appends the public key** to `~/.ssh/authorized_keys`
4. **Encrypts and uploads 4 GitHub secrets** via the API:
   - `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_PORT`, `SSH_USER`
5. **Commits a `deploy.yml` workflow** to `.github/workflows/`

From this point on, every push to `main` triggers:

```yaml
- git clone / git fetch + reset --hard origin/main
- docker compose down
- docker compose up -d --build
```

No password. No manual steps. Fully key-based.

---

## Requirements

**Local machine**
- Node.js 18+

**Server**
- SSH access (password or key)
- Docker + Docker Compose installed

**GitHub**
- Personal access token with `repo` + `secrets` scopes  
  → Settings → Developer settings → Personal access tokens → Generate new token

---

## Installation

**Run without installing (recommended):**
```bash
npx deploymate-cli
```

**Install globally:**
```bash
npm install -g deploymate-cli
deploymate
```

---

## Usage

### Use an existing repo
Run `deploymate`, choose **Use existing repo**, and enter `owner/repo`.

### Create a new repo from a local project
Run `deploymate`, choose **Create new repo**, and enter:
- Repo name, description, visibility
- Path to your local project (DeployMate will `git init`, commit, and push)

### SSH key auth (instead of password)
At the auth prompt, choose **SSH key file** and enter the path to your private key (e.g. `~/.ssh/id_rsa`). This is useful if your server already has password auth disabled.

---

## Generated workflow

```yaml
name: Deploy

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
          host: ${{ secrets.SSH_HOST }}
          username: ${{ secrets.SSH_USER }}
          port: ${{ secrets.SSH_PORT }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            if [ ! -d "/opt/my-app/.git" ]; then
              git clone https://github.com/yourname/my-app.git /opt/my-app
            fi
            cd /opt/my-app
            git fetch origin
            git reset --hard origin/main
            docker compose down || true
            docker compose up -d --build
```

---

## Security

- The SSH **password is used once** to bootstrap key-based auth. It is never logged, stored, or sent anywhere other than your server.
- The generated **private key lives only in memory** during the command. It goes directly into the GitHub secret via the API.
- GitHub secrets are **encrypted with libsodium** (box seal) before being sent, as required by the GitHub API.
- After setup, all deployments use **key-based SSH auth** — no password ever touches the network again.

---

## Roadmap

- [ ] Multi-server support (staging + production)
- [ ] Non-Docker projects (raw `git pull && npm run build`)  
- [ ] Rollback to previous commit
- [ ] Server health check (CPU, RAM, container status)
- [ ] GitLab / Bitbucket support
- [ ] Teardown command (remove secrets + workflow)

PRs welcome.

---

## Contributing

```bash
git clone https://github.com/Benyaminrmb/deploymate
cd deploymate
npm install
npm run dev
```

---

## License

MIT © [Benyamin Rmb](https://benyaminrmb.ir)

---

<p align="center">
  Made with ❤️ by <a href="https://benyaminrmb.ir">Benyamin Rmb</a>
  &nbsp;·&nbsp;
  <a href="https://reymit.ir/benyaminrmb">☕ Buy me a coffee</a>
</p>
