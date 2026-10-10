import type { LucideIcon } from 'lucide-react'

// Honest placeholder for features that are not built yet. No fake data, no dead buttons.
export default function ComingSoon({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="rounded-2xl bg-brand/15 p-4 text-brand"><Icon size={32} /></div>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-sm text-muted">{body}</p>
    </div>
  )
}
