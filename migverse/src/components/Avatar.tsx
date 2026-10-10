function hue(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

export default function Avatar({ id, name, url, size = 40 }: { id: string; name: string; url?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: size * 0.4 }
  if (url) return <img src={url} alt="" loading="lazy" className="shrink-0 rounded-full object-cover" style={style} />
  const initial = (Array.from(name.trim())[0] ?? '?').toUpperCase()
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ ...style, background: `hsl(${hue(id)} 60% 45%)` }}
      aria-hidden="true"
    >
      {initial}
    </div>
  )
}
