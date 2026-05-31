interface Step {
  id: string
  label: string
  status: 'running' | 'done' | 'error' | 'log'
  error?: string
}

interface Props {
  steps: Step[]
  logs: string[]
  error?: string
  done: boolean
  repo: string
}

export default function ProgressLog({ steps, logs, error, done, repo }: Props) {
  const icon = (status: Step['status']) => {
    if (status === 'running') return <span className="animate-spin inline-block text-yellow-400">⟳</span>
    if (status === 'done') return <span className="text-green-400">✓</span>
    if (status === 'log') return <span className="text-gray-500">›</span>
    return <span className="text-red-400">✗</span>
  }

  const mainSteps = steps.filter((s) => s.status !== 'log')

  return (
    <div className="mt-6 space-y-3">
      {/* Main steps */}
      <div className="bg-gray-900 rounded-xl p-5 font-mono text-sm space-y-2 border border-gray-700">
        {mainSteps.map((s) => (
          <div key={s.id} className="flex items-center gap-3">
            <span className="w-5 text-center">{icon(s.status)}</span>
            <span className={s.status === 'error' ? 'text-red-400' : 'text-gray-200'}>{s.label}</span>
          </div>
        ))}

        {error && (
          <div className="mt-3 p-3 bg-red-900/40 border border-red-500 rounded text-red-300 break-all">
            {error}
          </div>
        )}

        {done && !error && (
          <div className="mt-4 p-4 bg-green-900/30 border border-green-500 rounded space-y-2">
            <p className="text-green-300 font-semibold">All done! CI/CD is live.</p>
            <a
              href={`https://github.com/${repo}/actions`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 underline text-xs"
            >
              View GitHub Actions →
            </a>
          </div>
        )}
      </div>

      {/* Verbose log */}
      {logs.length > 0 && (
        <details className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
          <summary className="px-4 py-2 text-xs text-gray-500 cursor-pointer hover:text-gray-300 select-none">
            Verbose log ({logs.length} lines)
          </summary>
          <div className="px-4 pb-4 pt-2 font-mono text-xs text-gray-400 space-y-1 max-h-64 overflow-y-auto">
            {logs.map((line, i) => (
              <div key={i} className="leading-relaxed">
                <span className="text-gray-600 mr-2 select-none">{String(i + 1).padStart(3, '0')}</span>
                {line}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
