import { generateKeyPairSync, createPublicKey, type JsonWebKey } from 'crypto'
import { Client } from 'ssh2'

export interface KeyPair {
  publicKey: string
  privateKey: string
}

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

export function uploadPublicKey(
  host: string,
  port: number,
  username: string,
  password: string,
  publicKey: string,
  onLog: (msg: string) => void = () => {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    onLog(`Connecting to ${host}:${port} as ${username}…`)

    conn.on('handshake', (neg) => {
      onLog(`Handshake OK — cipher: ${neg.cs.cipher}, server host key: ${neg.serverHostKey}`)
    })

    conn.on('ready', () => {
      onLog('Authenticated. Running remote command…')

      const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${publicKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`

      conn.exec(cmd, (err, stream) => {
        if (err) {
          conn.end()
          return reject(err)
        }

        let stderr = ''
        stream.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
        stream.on('exit', (code: number | null) => {
          const exitCode = code ?? 0
          onLog(`Command exited with code ${exitCode}`)
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

    conn.connect({ host, port, username, password, readyTimeout: 20000, debug: (msg) => onLog(`[ssh2] ${msg}`) })
  })
}
