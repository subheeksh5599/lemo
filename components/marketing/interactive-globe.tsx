'use client'

import { useEffect, useRef } from 'react'

type Vec3 = { x: number; y: number; z: number }

const GOLDEN = Math.PI * (3 - Math.sqrt(5))
const GLOBE_POINTS = 820
const ARC_COUNT = 11

function spherePoints(count: number): Vec3[] {
  const points: Vec3[] = []
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = GOLDEN * i
    points.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius })
  }
  return points
}

function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))
  const omega = Math.acos(dot)
  if (omega < 0.0001) return a
  const sin = Math.sin(omega)
  const scaleA = Math.sin((1 - t) * omega) / sin
  const scaleB = Math.sin(t * omega) / sin
  return {
    x: a.x * scaleA + b.x * scaleB,
    y: a.y * scaleA + b.y * scaleB,
    z: a.z * scaleA + b.z * scaleB,
  }
}

function rotate(point: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const x1 = point.x * cy - point.z * sy
  const z1 = point.x * sy + point.z * cy
  const y1 = point.y * cp - z1 * sp
  const z2 = point.y * sp + z1 * cp
  return { x: x1, y: y1, z: z2 }
}

/**
 * An interactive dotted globe: drag to rotate, release for inertia, and arcs
 * travel between fixed points. Canvas only; no runtime dependency.
 */
export function InteractiveGlobe() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const points = spherePoints(GLOBE_POINTS)
    const arcs: { from: Vec3; to: Vec3 }[] = []
    for (let i = 0; i < ARC_COUNT; i += 1) {
      arcs.push({
        from: points[(i * 73 + 19) % points.length],
        to: points[(i * 151 + 241) % points.length],
      })
    }

    let yaw = 0.5
    let pitch = -0.32
    let velocity = 0.0008
    let dragging = false
    let lastX = 0
    let lastY = 0
    let pulse = 0
    let raf = 0

    function resize() {
      if (canvas === null) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, rect.width * dpr)
      canvas.height = Math.max(1, rect.height * dpr)
      context?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function draw() {
      if (canvas === null || context === null) return
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const cx = width / 2
      const cy = height / 2
      const radius = Math.min(width, height) * 0.37
      context.clearRect(0, 0, width, height)

      context.save()
      context.strokeStyle = 'rgba(110, 148, 255, 0.16)'
      context.lineWidth = 1
      context.beginPath()
      context.arc(cx, cy, radius, 0, Math.PI * 2)
      context.stroke()

      for (let lat = -60; lat <= 60; lat += 30) {
        const rx = Math.cos(lat * (Math.PI / 180)) * radius
        context.beginPath()
        context.ellipse(cx, cy + Math.sin(lat * (Math.PI / 180)) * radius * 0.62, rx, rx * 0.2, 0, 0, Math.PI * 2)
        context.stroke()
      }

      for (let lon = -60; lon <= 60; lon += 30) {
        const theta = (lon * Math.PI) / 180
        context.beginPath()
        context.ellipse(cx, cy, Math.abs(Math.sin(theta)) * radius, radius, 0, 0, Math.PI * 2)
        context.stroke()
      }
      context.restore()

      const projected: { x: number; y: number; z: number; depth: number }[] = []
      for (const point of points) {
        const p = rotate(point, yaw, pitch)
        projected.push({
          x: cx + p.x * radius,
          y: cy + p.y * radius,
          z: p.z,
          depth: p.z,
        })
      }

      for (const p of projected) {
        const front = p.depth > -0.15
        const alpha = front ? 0.2 + Math.max(0, p.depth + 1) * 0.55 : 0.05
        context.beginPath()
        context.arc(p.x, p.y, p.depth > 0.35 ? 1.9 : p.depth > -0.2 ? 1.3 : 0.8, 0, Math.PI * 2)
        context.fillStyle =
          p.depth > 0.45
            ? `rgba(52, 252, 255, ${alpha})`
            : `rgba(110, 148, 255, ${alpha})`
        context.fill()
      }

      pulse = (pulse + 0.0035) % 1

      for (const arc of arcs) {
        const samples: { x: number; y: number; visible: boolean }[] = []
        for (let step = 0; step <= 40; step += 1) {
          const t = step / 40
          const point = slerp(arc.from, arc.to, t)
          const p = rotate(point, yaw, pitch)
          samples.push({
            x: cx + p.x * radius,
            y: cy + p.y * radius,
            visible: p.z > -0.05,
          })
        }

        context.save()
        context.strokeStyle = 'rgba(110, 148, 255, 0.34)'
        context.lineWidth = 1
        context.beginPath()
        let drawing = false
        for (const sample of samples) {
          if (!sample.visible) {
            drawing = false
            continue
          }
          if (!drawing) {
            context.moveTo(sample.x, sample.y)
            drawing = true
          } else {
            context.lineTo(sample.x, sample.y)
          }
        }
        context.stroke()

        const index = Math.min(samples.length - 1, Math.floor(pulse * samples.length))
        const head = samples[index]
        if (head.visible) {
          context.beginPath()
          context.arc(head.x, head.y, 2.1, 0, Math.PI * 2)
          context.fillStyle = 'rgba(52, 252, 255, 0.95)'
          context.shadowColor = 'rgba(52, 252, 255, 0.8)'
          context.shadowBlur = 8
          context.fill()
        }
        context.restore()
      }

      if (!dragging) {
        velocity *= 0.985
        yaw += reduce ? 0 : velocity + 0.00045
      }
      raf = window.requestAnimationFrame(draw)
    }

    resize()
    draw()
    window.addEventListener('resize', resize)

    function down(event: PointerEvent) {
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      canvas?.setPointerCapture(event.pointerId)
    }

    function move(event: PointerEvent) {
      if (!dragging) return
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      yaw += dx * 0.006
      pitch = Math.max(-1.1, Math.min(1.1, pitch + dy * 0.004))
      velocity = dx * 0.0012
      lastX = event.clientX
      lastY = event.clientY
    }

    function up(event: PointerEvent) {
      dragging = false
      canvas?.releasePointerCapture(event.pointerId)
    }

    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)

    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-label="Drag to rotate the globe"
      className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing"
    />
  )
}
