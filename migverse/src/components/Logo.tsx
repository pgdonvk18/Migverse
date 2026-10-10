import { BRAND } from '../brand'

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="14" fill="rgb(var(--brand))" />
      <path d="M12 16a5 5 0 0 1 5-5h14a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H22l-6 6v-6a5 5 0 0 1-4-5z" fill="#fff" />
      <circle cx="19" cy="20" r="2" fill="rgb(var(--brand))" />
      <circle cx="25" cy="20" r="2" fill="rgb(var(--brand))" />
      <circle cx="31" cy="20" r="2" fill="rgb(var(--brand))" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-xl font-extrabold tracking-tight">{BRAND.name}</span>
    </div>
  )
}
