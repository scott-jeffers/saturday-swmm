/**
 * A preview of the GitHub features being planned: saving projects to GitHub,
 * opening them from there, working on them together, and reviewing changes as
 * pull requests. Nothing here connects to GitHub yet.
 */
import { GitBranch, GitPullRequest, Save, Users } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cn } from '../lib/cn'

const FEATURES = [
  { icon: Save, title: 'Save to GitHub', body: 'Keep the project in a repository you choose, from the app or the browser, and pick it up anywhere.' },
  { icon: GitBranch, title: 'Projects from GitHub', body: 'Open any project in your repositories, with its scenarios, storms and saved versions.' },
  { icon: Users, title: 'Work together', body: 'Share a project with colleagues and see who changed what, and when.' },
  { icon: GitPullRequest, title: 'Changes for review', body: 'Propose model changes as a pull request, with a map of what changed, and merge them once they’re checked.' },
]

export const GITHUB_FEEDBACK_URL = 'https://github.com/scott-jeffers/saturday-swmm/issues'

export function GitHubTeaser({ className }: { className?: string }) {
  // Opened from "Save to GitHub" in the save menu: bring it into view.
  const [params] = useSearchParams()
  const ref = useRef<HTMLElement>(null)
  const show = params.get('show') === 'github'
  useEffect(() => {
    if (show) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [show])
  return (
    <section ref={ref} id="github" className={cn(show && 'ring-2 ring-ic-scen/40', 'rounded-[var(--radius-panel)] border border-dashed border-border-strong bg-elevated p-3 text-[12px]', className)}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <GitPullRequest className="h-3.5 w-3.5 text-ic-scen" />
        <h2 className="m-0 text-[12.5px] font-semibold text-fg">GitHub</h2>
        <span className="rounded-full bg-ic-scen/15 px-1.5 py-px text-[10.5px] font-medium text-ic-scen">Coming later</span>
      </div>
      <p className="m-0 mb-2 text-muted">Planned: your projects on GitHub, with history, teamwork and review built in.</p>
      <ul className="m-0 list-none space-y-2 p-0">
        {FEATURES.map((f) => (
          <li key={f.title} className="flex gap-2">
            <f.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="min-w-0">
              <span className="block font-medium text-fg-soft">{f.title}</span>
              <span className="block leading-snug text-muted">{f.body}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-2.5 border-t border-border pt-2 text-[11.5px] leading-snug text-muted">
        Access would be limited to the repositories you pick.{' '}
        <a href={GITHUB_FEEDBACK_URL} target="_blank" rel="noreferrer" className="text-accent-soft hover:underline">
          Tell us what you’d use
        </a>
      </p>
    </section>
  )
}
