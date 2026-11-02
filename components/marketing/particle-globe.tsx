'use client'

import { useEffect, useRef } from 'react'

/**
 * A static dot field arranged as a sphere, with a slow rotation. It is the
 * page's one atmospheric visual; nothing else on the page moves on scroll.
 */
export function ParticleGlobe() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const points: { x: number; y: number; z: number }[] = []
    const count = 760
    const golden = Math.PI * (3 - Math.sqrt(5))

    for (let i = 0; i < count; i += 1) {
      const y = 1 - (i / (count - 1)) * 2
      const radius = Math.sqrt(Math.max(0, 1 - y * y))
      const theta = golden * i
      points.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius })
    }

    let frame = 0
    let angle = 0.4
    let raf = 0

    function resize() {
      if (canvas === null) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const size = Math.min(window.innerWidth, 1500)
      canvas.width = size * dpr
      canvas.height = size * dpr
      canvas.style.width = `${size}px`
      canvas.style.height = `${size}px`
      context?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function draw() {
      if (canvas === null || context === null) return
      const size = canvas.clientWidth
      const cx = size / 2
      const cy = size / 2
      const scale = size * 0.42
      context.clearRect(0, 0, size, size)

      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const tilt = -0.32
      const cosT = Math.cos(tilt)
      const sinT = Math.sin(tilt)

      const radius = scale
      context.save()
      context.strokeStyle = 'rgba(110, 148, 255, 0.14)'
      context.lineWidth = 1
      context.beginPath()
      context.arc(cx, cy, radius, 0, Math.PI * 2)
      context.stroke()

      for (let lat = -60; lat <= 60; lat += 30) {
        const phi = (lat * Math.PI) / 180
        const y = cy + Math.sin(phi) * radius
        const rx = Math.cos(phi) * radius
        context.beginPath()
        context.ellipse(cx, y, rx, rx * 0.18, 0, 0, Math.PI * 2)
        context.stroke()
      }

      for (let lon = -60; lon <= 60; lon += 30) {
        const theta = (lon * Math.PI) / 180
        context.beginPath()
        context.ellipse(cx, cy, Math.abs(Math.sin(theta)) * radius, radius, 0, 0, Math.PI * 2)
        context.stroke()
      }
      context.restore()

      for (const point of points) {
        const x = point.x * cos - point.z * sin
        const z = point.x * sin + point.z * cos
        const y = point.y * cosT - z * sinT
        const depth = point.y * sinT + z * cosT
        const px = cx + x * scale
        const py = cy + y * scale
        const alpha = 0.18 + Math.max(0, depth + 1) * 0.48
        const radius = depth > 0.35 ? 2.1 : depth > -0.2 ? 1.55 : 1.05
        context.beginPath()
        context.arc(px, py, radius, 0, Math.PI * 2)
        context.fillStyle =
          depth > 0.45
            ? `rgba(52, 252, 255, ${alpha})`
            : `rgba(110, 148, 255, ${alpha * 1.1})`
        context.fill()
      }

      frame += 1
      if (!reduce) {
        angle += 0.0007
        raf = window.requestAnimationFrame(draw)
      }
    }

    resize()
    draw()
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
      window.cancelAnimationFrame(raf)
      void frame
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-100"
    />
  )
}
