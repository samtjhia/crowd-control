import { useLayoutEffect, useRef } from 'react'

const GROUPS = '.hero-copy, .story-stop, .section-heading, .closing'
const COPY = 'h1, h2, p, .example-prompt, .plain-checks, .text-link, .button'

/** Progressive enhancement: the DOM and stylesheet always contain visible text.
 * Only supported, successfully initialized animations can temporarily cover it.
 * No text splitting, layout measurements, scroll listeners, or extra wrappers.
 */
export function useTextEntrances() {
  const root = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const element = root.current
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!element || preference.matches || !window.IntersectionObserver || !Element.prototype.animate) return

    const groups = new Map<Element, Animation[]>()
    let observer: IntersectionObserver | undefined
    const reveal = (group: Element, immediate = false) => {
      const animations = groups.get(group)
      if (!animations) return
      groups.delete(group) // Entrances cannot be armed again on a return scroll.
      observer?.unobserve(group.querySelector('h1, h2') ?? group)
      for (const animation of animations) {
        if (immediate) animation.cancel()
        else animation.play()
      }
    }
    const releaseAll = () => {
      observer?.disconnect()
      for (const group of groups.keys()) reveal(group, true)
      // Include entrances already playing when motion preferences change.
      for (const animation of active) animation.cancel()
      active.clear()
    }
    const active = new Set<Animation>()
    const onPreference = () => { if (preference.matches) releaseAll() }
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Element) {
        const group = event.target.closest(GROUPS)
        if (group) reveal(group, true)
      }
    }

    try {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const group = entry.target.closest(GROUPS)
            if (group) reveal(group)
          }
        }
      }, { rootMargin: '0px 0px -20% 0px', threshold: 0 })

      for (const group of element.querySelectorAll(GROUPS)) {
        const heading = group.querySelector('h1, h2')
        if (!heading) continue
        // A restored scroll position must never leave earlier content hidden.
        if (heading.getBoundingClientRect().bottom <= 0) continue
        const animations: Animation[] = []
        groups.set(group, animations)
        for (const [index, target] of [...group.querySelectorAll<HTMLElement>(COPY)].entries()) {
          const animation = target.animate([
            { opacity: 0, transform: `translateY(${index === 0 ? 16 : 12}px)` },
            { opacity: 1, transform: 'translateY(0)' },
          ], {
            duration: index === 0 ? 680 : 560,
            delay: index === 0 ? 0 : Math.min(140 + (index - 1) * 75, 340),
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'both',
          })
          animation.pause()
          animations.push(animation)
          active.add(animation)
          animation.onfinish = () => { animation.cancel(); active.delete(animation) }
        }
        observer.observe(heading)
      }
      preference.addEventListener('change', onPreference)
      element.addEventListener('focusin', onFocus)
      window.addEventListener('beforeprint', releaseAll)
    } catch {
      // A missing/failed enhancement leaves the original content visible.
      releaseAll()
    }
    return () => {
      releaseAll()
      preference.removeEventListener('change', onPreference)
      element.removeEventListener('focusin', onFocus)
      window.removeEventListener('beforeprint', releaseAll)
    }
  }, [])

  return root
}
