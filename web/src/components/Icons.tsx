export type IconName = 'arrow' | 'diagonal' | 'school' | 'concert' | 'checkin' | 'alley' | 'play' | 'pause' | 'reset' | 'check' | 'spark' | 'down'
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    diagonal: <path d="M6 18 18 6M6 6h12v12" />,
    down: <path d="M12 4v15m-6-6 6 6 6-6" />,
    school: <><path d="m3 10 9-6 9 6v10H3Z" /><path d="M9 20v-6h6v6M7 10h.01M17 10h.01M12 8h.01" /></>,
    concert: <><path d="M3 20V7h18v13M3 11h18M7 7V3m10 4V3M7 16v4m5-5v5m5-4v4" /><path d="m7 3 3 2m7-2-3 2" /></>,
    checkin: <><path d="M3 10h18v6H3zm3 6v5m12-5v5M7 6V3m10 3V3" /><path d="M10 6h4" /></>,
    alley: <><path d="M3 21V3h5v18M16 21V3h5v18M11 5l2-2 2 2M13 3v7M9 19l2 2 2-2m-2 2v-7" /></>,
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    reset: <><path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
