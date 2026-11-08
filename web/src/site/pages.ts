import { History, Map as MapIcon, Play } from 'lucide-react'

/** The site's pages, in the order the header and account menu list them; `short` for narrow screens. */
export const PAGES = [
  { href: '/history', label: 'Past runs', short: 'Runs', Icon: History },
  { href: '/sim', label: 'Simulator', short: 'Simulator', Icon: Play },
  { href: '/plans', label: 'Floor plans', short: 'Plans', Icon: MapIcon },
] as const
