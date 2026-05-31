import { generateKeyPairSync, createPublicKey, type JsonWebKey } from 'crypto'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { Client } from 'ssh2'

export interface KeyPair {
  publicKey: string
  privateKey: string
}

export type SshAuth =
  | { type: 'password'; password: string }
  | { type: 'key'; keyPath: string }

function spkiPemToOpenSsh(pem: string): string {
  const jwk = createPublicKey(pem).export({ format: 'jwk' }) as JsonWebKey & { e: string; n: string }
  const fromB64url = (s: string): Buffer => {
    const b = Buffer.from(s, 'base64url')
    return b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b
  }
  const encodeField = (b: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(b.length); return Buffer.concat([len, b])
  }
  const type = encodeField(Buffer.from('ssh-rsa'))
  const e    = encodeField(fromB64url(jwk.e))
  const n    = encodeField(fromB64url(jwk.n))
  return `ssh-rsa ${Buffer.concat([type, e, n]).toString('base64')} deploymate`
}

export function generateKeyPair(): KeyPair {
  const { publicKey: pubPem, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKey: spkiPemToOpenSsh(pubPem), privateKey }
}

function resolveKeyPath(p: string): string {
  return p.startsWith('~') ? p.replace('~', homedir()) : p
}

export function uploadPublicKey(
  host: string,
  port: number,
  username: string,
  auth: SshAuth,
  publicKey: string,
  onLog: (msg: string) => void = () => {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    onLog(`Connecting to ${host}:${port} as ${username}…`)

    conn.on('ready', () => {
      onLog('Authenticated — uploading public key…')
      const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${publicKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`

      conn.exec(cmd, (err, stream) => {
        if (err) { conn.end(); return reject(err) }

        let stderr = ''
        stream.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
        stream.on('exit', (code: number | null) => {
          const exitCode = code ?? 0
          conn.end()
          if (exitCode !== 0) reject(new Error(`Remote command failed (exit ${exitCode}): ${stderr.trim()}`))
          else { onLog('Public key appended to ~/.ssh/authorized_keys'); resolve() }
        })
      })
    })

    conn.on('error', (err) => {
      onLog(`SSH error: ${err.message}`)
      reject(err)
    })

    const connectOpts: Parameters<Client['connect']>[0] = {
      host, port, username, readyTimeout: 20000,
    }

    if (auth.type === 'password') {
      connectOpts.password = auth.password
    } else {
      const keyPath = resolveKeyPath(auth.keyPath)
      connectOpts.privateKey = readFileSync(keyPath)
    }

    conn.connect(connectOpts)
  })
}
