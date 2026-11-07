import { History, Map as MapIcon, Play } from 'lucide-react'

/** The site's pages, in the order the header and account menu list them; `short` for narrow screens. */
export const PAGES = [
  { href: '/sim', label: 'Simulator', short: 'Simulator', Icon: Play },
  { href: '/editor', label: 'Floor plans', short: 'Plans', Icon: MapIcon },
  { href: '/history', label: 'Past simulations', short: 'History', Icon: History },
] as const
