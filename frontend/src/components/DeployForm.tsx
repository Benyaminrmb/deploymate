import { useState } from 'react'
import ProgressLog from './ProgressLog'

// Edit these to prefill the form for quick testing
const TEST_DEFAULTS = {
  sshHost: '2.58.172.118',
  sshPort: '9011',
  sshUsername: 'root',
  sshPassword: '',
  githubToken: '',
  githubRepo: 'Benyaminrmb/sample-docker-app',
  deployPath: '/opt/app',
  composeFile: 'docker-compose.yml',
}

interface Step {
  id: string
  label: string
  status: 'running' | 'done' | 'error'
}

interface FormData {
  sshHost: string
  sshPort: string
  sshUsername: string
  sshPassword: string
  githubToken: string
  githubRepo: string
  deployPath: string
  composeFile: string
}

export default function DeployForm() {
  const [form, setForm] = useState<FormData>({
    sshHost: '',
    sshPort: '22',
    sshUsername: 'root',
    sshPassword: '',
    githubToken: '',
    githubRepo: '',
    deployPath: '/opt/app',
    composeFile: 'docker-compose.yml',
  })

  const [steps, setSteps] = useState<Step[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string>()
  const [done, setDone] = useState(false)
  const [running, setRunning] = useState(false)

  const set = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const upsertStep = (step: Step) =>
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === step.id)
      if (idx === -1) return [...prev, step]
      const next = [...prev]
      next[idx] = step
      return next
    })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSteps([])
    setLogs([])
    setError(undefined)
    setDone(false)
    setRunning(true)

    const body = {
      ssh: {
        host: form.sshHost,
        port: Number(form.sshPort),
        username: form.sshUsername,
        password: form.sshPassword,
      },
      github: {
        token: form.githubToken,
        repo: form.githubRepo,
      },
      deployPath: form.deployPath,
      composeFile: form.composeFile,
    }

    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        buf += decoder.decode(value, { stream: true })

        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = JSON.parse(line.slice(6))
          if (payload.done) {
            setDone(true)
          } else if (payload.error) {
            setError(payload.error)
          } else if (payload.id === 'log') {
            setLogs((prev) => [...prev, payload.label])
          } else {
            upsertStep(payload as Step)
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setRunning(false)
    }
  }

  const field = (label: string, key: keyof FormData, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={set(key)}
        placeholder={placeholder}
        required
        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
      />
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white">DeployMate</h1>
          <p className="text-gray-400 mt-1 text-sm">
            One form. One click. Full CI/CD on your VPS.
          </p>
          <button
            type="button"
            onClick={() => setForm(TEST_DEFAULTS)}
            className="mt-3 text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2"
          >
            Fill test data
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-5">
          <section>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-3">SSH Server</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">{field('Host', 'sshHost', 'text', '1.2.3.4')}</div>
              <div>{field('Port', 'sshPort', 'number', '22')}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              {field('Username', 'sshUsername', 'text', 'root')}
              {field('Password', 'sshPassword', 'password', '••••••••')}
            </div>
          </section>

          <hr className="border-gray-700" />

          <section>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-3">GitHub</p>
            {field('Personal Access Token', 'githubToken', 'password', 'ghp_…')}
            <p className="text-xs text-gray-500 mt-1 mb-3">
              Needs <code className="text-gray-400">repo</code> + <code className="text-gray-400">secrets</code> scopes
            </p>
            {field('Repository', 'githubRepo', 'text', 'owner/repo')}
          </section>

          <hr className="border-gray-700" />

          <section>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-3">Deploy Config</p>
            <div className="grid grid-cols-2 gap-3">
              {field('Deploy Path', 'deployPath', 'text', '/opt/app')}
              {field('Compose File', 'composeFile', 'text', 'docker-compose.yml')}
            </div>
          </section>

          <button
            type="submit"
            disabled={running}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
          >
            {running ? 'Deploying…' : 'Connect & Deploy'}
          </button>
        </form>

        {steps.length > 0 && (
          <ProgressLog steps={steps} logs={logs} error={error} done={done} repo={form.githubRepo} />
        )}
      </div>
    </div>
  )
}
