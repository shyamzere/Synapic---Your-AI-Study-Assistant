import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import { motion, AnimatePresence, useMotionValue, useSpring, useInView, useTransform, useReducedMotion } from 'framer-motion'
import synapicLogo from './assets/synapicLogo1.png'
import { supabase } from './supabase'
import Authentication from './Authentication'

// ── Design tokens ────────────────────────────────────────────
const LIGHT_THEME = {
  bg: '#F7F5F0',
  bgCard: '#FFFFFF',
  bgCardHover: '#F0EDE8',
  border: '#E8E4DC',
  borderStrong: '#D4CFC5',
  text: '#1A1A18',
  textMuted: '#6B6860',
  textLight: '#9B9890',
  accent: '#0D9373',
  accentLight: '#E6F5F0',
  accentDark: '#0A7A5F',
  accentGrad: 'linear-gradient(135deg, #0D9373, #0A7A5F)',
  danger: '#E53E3E',
  dangerLight: '#FFF5F5',
  success: '#38A169',
  successLight: '#F0FFF4',
  warning: '#D69E2E',
  navBg: 'rgba(247,245,240,0.85)',
}

const DARK_THEME = {
  bg: '#111111',
  bgCard: '#1B1B19',
  bgCardHover: '#252520',
  border: '#34342E',
  borderStrong: '#4A4A42',
  text: '#F6F3EA',
  textMuted: '#B9B4A8',
  textLight: '#858176',
  accent: '#16B892',
  accentLight: '#12382F',
  accentDark: '#6DE0C2',
  accentGrad: 'linear-gradient(135deg, #16B892, #0D9373)',
  danger: '#F87171',
  dangerLight: '#351A1A',
  success: '#4ADE80',
  successLight: '#15351F',
  warning: '#FBBF24',
  navBg: 'rgba(17,17,17,0.88)',
}

let C = LIGHT_THEME

const MAX_INPUT_CHARS = 100_000
const GUEST_MAX_INPUT_CHARS = 12_000
const FREE_GENERATION_LIMIT = 5
const APP_TABS = [
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'quizzes', label: 'Quizzes' },
  { id: 'summary', label: 'Summary' },
  { id: 'decks', label: 'My Decks' },
  { id: 'settings', label: 'Settings' },
]

const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const daysBetweenDateKeys = (fromKey, toKey) => {
  if (!fromKey || !toKey) return Infinity
  const from = new Date(`${fromKey}T00:00:00`)
  const to = new Date(`${toKey}T00:00:00`)
  return Math.round((to - from) / 86400000)
}

const makeDefaultDeckTitle = (text) => {
  const trimmed = text.trim()
  if (!trimmed) return 'Untitled Deck'
  return trimmed.slice(0, 50) + (trimmed.length > 50 ? '...' : '')
}

// ── Animation variants ───────────────────────────────────────
// These are reusable animation configs we pass to Framer Motion
const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.3, ease: 'easeOut' }
}

const staggerContainer = {
  animate: { transition: { staggerChildren: 0.07 } }
}

const cardVariant = {
  initial: { opacity: 0, y: 16, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { duration: 0.3, ease: 'easeOut' }
}

const studyFlipTransition = {
  type: 'spring',
  stiffness: 150,
  damping: 24,
  mass: 0.75,
}

const cardSwapTransition = {
  opacity: { duration: 0.16, ease: 'easeOut' },
  y: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  scale: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  rotateY: studyFlipTransition,
}

// ── Cursor glow ───────────────────────────────────────────────
// Renders a soft teal radial light that follows the mouse with spring lag
function CursorGlow() {
  const mouseX = useMotionValue(-200)
  const mouseY = useMotionValue(-200)
  // Spring config: lower stiffness = more lag (feels floaty and premium)
  const springX = useSpring(mouseX, { stiffness: 240, damping: 28 })
  const springY = useSpring(mouseY, { stiffness: 240, damping: 28 })

  useEffect(() => {
    const move = (e) => {
      mouseX.set(e.clientX)
      mouseY.set(e.clientY)
    }
    window.addEventListener('mousemove', move)
    return () => window.removeEventListener('mousemove', move)
  }, [])

  return (
    <motion.div
      style={{
        position: 'fixed',
        top: 0, left: 0,
        x: springX,
        y: springY,
        translateX: '-50%',
        translateY: '-50%',
        width: '360px',
        height: '360px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(13,147,115,0.04) 0%, transparent 64%)',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    />
  )
}

// ── Scroll reveal wrapper ──────────────────────────────────────
// Wrap any section in this and it fades+slides up when it enters viewport
function DecorativeGlowLayer({ variant = 'study' }) {
  const glows = variant === 'landing'
    ? [
      { top: '1400px', right: '-210px', width: '420px', height: '420px', opacity: 0.16 },
      { top: '2900px', left: '-190px', width: '360px', height: '360px', opacity: 0.11 },
      { bottom: '-120px', right: '-90px', width: '320px', height: '320px', opacity: 0.09 },
    ]
    : [
      { top: '115px', right: '-220px', width: '420px', height: '420px', opacity: 0.14 },
      { top: '560px', left: '-210px', width: '360px', height: '360px', opacity: 0.1 },
      { bottom: '-130px', right: '-120px', width: '330px', height: '330px', opacity: 0.08 },
    ]

  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      {glows.map((glow, idx) => (
        <div
          key={idx}
          style={{
            position: 'absolute',
            ...glow,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${C.accent}, transparent)`,
          }}
        />
      ))}
    </div>
  )
}

function ScrollReveal({ children, delay = 0 }) {
  const ref = useRef(null)
  // useInView from framer-motion fires once when element enters viewport
  const isInView = useInView(ref, { once: true, margin: '-80px' })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  )
}

// ── Particle canvas ────────────────────────────────────────────
// Draws a field of floating dots connected by lines when close together
// Subtly reacts to mouse position - like a neural network / constellation
function ParticleCanvas() {
  const canvasRef = useRef(null)
  const mouse = useRef({ x: -1000, y: -1000, vx: 0, vy: 0, active: false })

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    let animId
    let particles = []

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }

    class Particle {
      constructor() { this.reset() }
      reset() {
        this.x = Math.random() * canvas.width
        this.y = Math.random() * canvas.height
        this.vx = (Math.random() - 0.5) * 0.34
        this.vy = (Math.random() - 0.5) * 0.34
        this.radius = Math.random() * 1.7 + 0.7
        this.alpha = Math.random() * 0.5 + 0.18
        this.drift = Math.random() * Math.PI * 2
      }
      update() {
        // Cursor flow: particles follow movement without collapsing into a dense cluster.
        const dx = mouse.current.x - this.x
        const dy = mouse.current.y - this.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const influence = 390
        const spacing = 150

        if (mouse.current.active && dist < influence) {
          const falloff = Math.pow(1 - dist / influence, 1.35)
          const nx = dist > 0 ? dx / dist : 0
          const ny = dist > 0 ? dy / dist : 0
          const cursorSpeed = Math.min(Math.sqrt(mouse.current.vx * mouse.current.vx + mouse.current.vy * mouse.current.vy), 28)

          this.vx += mouse.current.vx * 0.0048 * falloff
          this.vy += mouse.current.vy * 0.0048 * falloff

          if (dist > spacing) {
            this.vx += nx * falloff * 0.0015
            this.vy += ny * falloff * 0.0015
          } else {
            const repel = (1 - dist / spacing) * (0.055 + cursorSpeed * 0.0015)
            this.vx -= nx * repel
            this.vy -= ny * repel
          }

          const swirl = cursorSpeed * 0.00045 * falloff
          this.vx += -ny * swirl
          this.vy += nx * swirl
        }

        this.drift += 0.006
        this.vx += Math.cos(this.drift) * 0.0028
        this.vy += Math.sin(this.drift * 0.85) * 0.0028
        this.vx *= 0.984
        this.vy *= 0.984

        // Speed cap so particles don't fly off
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy)
        if (speed > 1.15) { this.vx *= 1.15 / speed; this.vy *= 1.15 / speed }

        this.x += this.vx
        this.y += this.vy
        // Wrap around edges
        if (this.x < 0) this.x = canvas.width
        if (this.x > canvas.width) this.x = 0
        if (this.y < 0) this.y = canvas.height
        if (this.y > canvas.height) this.y = 0
      }
      draw() {
        ctx.beginPath()
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(13,147,115,${this.alpha})`
        ctx.fill()
      }
    }

    resize()
    // Create 80 particles - enough for density without hurting performance
    particles = Array.from({ length: 95 }, () => new Particle())
    window.addEventListener('resize', resize)

    const track = (e) => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      mouse.current = {
        x,
        y,
        vx: mouse.current.active ? x - mouse.current.x : 0,
        vy: mouse.current.active ? y - mouse.current.y : 0,
        active: true,
      }
    }
    window.addEventListener('mousemove', track)

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      // Draw connecting lines between close particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 145) {
            // Line fades out as particles get further apart
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(13,147,115,${0.26 * (1 - dist / 145)})`
            ctx.lineWidth = 0.65
            ctx.stroke()
          }
        }
        particles[i].update()
        particles[i].draw()
      }
      animId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', track)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: 0.9,
      }}
    />
  )
}

// ── MockCard for landing ─────────────────────────────────────
function MockCard() {
  const [flipped, setFlipped] = useState(false)
  useEffect(() => {
    const t = setInterval(() => setFlipped(f => !f), 2400)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={{ perspective: '1000px' }} className="w-72 h-52 cursor-pointer"
      onClick={() => setFlipped(f => !f)}>
      <motion.div
        animate={{ rotateY: flipped ? 180 : 0, y: flipped ? -3 : 0, scale: flipped ? 1.015 : 1 }}
        transition={{ type: 'spring', stiffness: 190, damping: 21, mass: 0.7 }}
        style={{ transformStyle: 'preserve-3d', position: 'relative', width: '100%', height: '100%' }}
      >
        {/* Front */}
        <div style={{
          backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
          position: 'absolute', inset: 0,
          background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(232,228,220,0.8)',
          borderRadius: '20px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '32px', textAlign: 'center',
        }}>
          <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em', color: '#9B9890', marginBottom: '16px', fontWeight: 600 }}>
            Question
          </p>
          <p style={{ fontSize: '15px', fontWeight: 700, color: '#1A1A18', lineHeight: 1.5 }}>
            What is the powerhouse of the cell?
          </p>
          <p style={{ fontSize: '11px', color: '#9B9890', marginTop: '20px', letterSpacing: '0.05em' }}>
            Click to reveal
          </p>
        </div>
        {/* Back */}
        <div style={{
          backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
          transform: 'rotateY(180deg)',
          position: 'absolute', inset: 0,
          background: C.accentGrad,
          borderRadius: '20px',
          boxShadow: `0 24px 64px ${C.accent}50`,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '32px', textAlign: 'center',
        }}>
          <p style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.6)', marginBottom: '16px', fontWeight: 600 }}>
            Answer
          </p>
          <p style={{ fontSize: '15px', fontWeight: 700, color: 'white', lineHeight: 1.5 }}>
            The Mitochondria
          </p>
        </div>
      </motion.div>
    </div>
  )
}

// ── Landing ──────────────────────────────────────────────────
function Landing({ onEnter, onSelectTab, activeTab, onAuth, user, onSignOut }) {
  const scrollY = useMotionValue(0)
  const heroRef = useRef(null)
  const whatSynapicDoesRef = useRef(null)

  // Parallax: hero content moves up slower than scroll
  useEffect(() => {
    const onScroll = () => scrollY.set(window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const heroY = useTransform(scrollY, [0, 600], [0, -120])
  const heroOpacity = useTransform(scrollY, [0, 620, 1080], [1, 1, 0])

  const scrollToWhatSynapicDoes = () => {
    whatSynapicDoesRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  const features = [
    {
      title: 'Flashcards',
      desc: 'AI generates a full deck from your notes. Study with our 3D flip cards or grid view.',
      preview: 'flashcards',
    },
    {
      title: 'Quizzes',
      desc: 'Auto-scored multiple choice questions with explanations. Know exactly where you stand.',
      preview: 'quiz',
    },
    {
      title: 'Summaries',
      desc: 'Dense lecture notes distilled into clean overviews, key points, and conclusions.',
      preview: 'summary',
    },
  ]

  const demoOutputs = [
    { label: 'Flashcard', text: 'What process converts glucose into ATP?' },
    { label: 'Quiz', text: 'Which stage produces the most ATP?' },
    { label: 'Summary', text: 'Cellular respiration releases usable energy through glycolysis, the Krebs cycle, and oxidative phosphorylation.' },
  ]

  const faqs = [
    {
      q: 'Is Synapic free to start?',
      a: 'Yes. You can paste notes and generate study material without needing a credit card.',
    },
    {
      q: 'Can I save my flashcard decks?',
      a: 'Yes. Create a free account to keep your decks and revisit them later.',
    },
    {
      q: 'What notes work best?',
      a: 'Lecture notes, textbook chapters, study guides, and pasted class material all work well.',
    },
    { q: 'How does the AI know what to generate?',
      a: 'Our models have been fine-tuned on thousands of study materials to understand how to create effective flashcards, quizzes, and summaries from your notes.',

    },
    { q: 'What are new Features coming out soon?',
      a: 'Expect chat with notes, where you can ask the AI further questions, and studying based on your weaknessees and strengths, through our spaced repetition model!',

    },
  ]

  const renderFeaturePreview = (type) => {
    if (type === 'flashcards') {
      return (
        <div style={{ display: 'grid', gap: '8px' }}>
          {['Question', 'Answer'].map((label, idx) => (
            <div key={label} style={{
              padding: '12px',
              borderRadius: '12px',
              background: idx === 0 ? C.bg : C.accentLight,
              border: `1px solid ${idx === 0 ? C.border : `${C.accent}30`}`,
            }}>
              <p style={{ fontSize: '10px', fontWeight: 800, color: idx === 0 ? C.textLight : C.accent, textTransform: 'uppercase', marginBottom: '5px' }}>
                {label}
              </p>
              <p style={{ fontSize: '12px', color: C.text, fontWeight: 700, lineHeight: 1.35 }}>
                {idx === 0 ? 'What is active recall?' : 'Testing memory before rereading notes.'}
              </p>
            </div>
          ))}
        </div>
      )
    }

    if (type === 'quiz') {
      return (
        <div style={{ display: 'grid', gap: '7px' }}>
          <p style={{ fontSize: '12px', color: C.text, fontWeight: 800, lineHeight: 1.35 }}>
            Which method improves long-term memory?
          </p>
          {['Rereading only', 'Active recall', 'Highlighting everything'].map((option, idx) => (
            <div key={option} style={{
              padding: '8px 10px',
              borderRadius: '10px',
              background: idx === 1 ? C.accentLight : C.bg,
              border: `1px solid ${idx === 1 ? C.accent : C.border}`,
              color: idx === 1 ? C.accentDark : C.textMuted,
              fontSize: '11px',
              fontWeight: 700,
            }}>
              {option}
            </div>
          ))}
        </div>
      )
    }

    return (
      <div style={{ display: 'grid', gap: '8px' }}>
        {['Key idea', 'Definition', 'Conclusion'].map((label, idx) => (
          <div key={label} style={{ display: 'flex', gap: '9px', alignItems: 'center' }}>
            <span style={{
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              background: idx === 0 ? C.accent : C.accentLight,
              color: idx === 0 ? 'white' : C.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: 900,
              flex: '0 0 auto',
            }}>
              {idx + 1}
            </span>
            <span style={{ height: '8px', borderRadius: '20px', background: idx === 1 ? C.borderStrong : C.border, flex: 1 }} />
          </div>
        ))}
      </div>
    )
  }

  const testimonials = [
    {
      quote: "I used Synapic for my first-year psychology lectures and turned messy notes into revision cards before the bus ride home.",
      name: 'Anonymous Student',
      role: 'Psychology student, UOA',
      initials: 'AS',
    },
    {
      quote: 'The summaries helped me find the actual exam concepts in long biology readings without losing the details I needed.',
      name: 'Anonymous Student',
      role: 'Pre-med student, UOA',
      initials: 'AS',
    },
    {
      quote: 'I save decks by topic now, so finals revision feels organised instead of starting from scratch every week.',
      name: 'Anonymous Student',
      role: 'Business student, AUT',
      initials: 'AS',
    },
  ]

  return (
    <div style={{ background: C.bg, minHeight: '100vh', overflowX: 'hidden', position: 'relative', isolation: 'isolate' }}>
      <CursorGlow />
      <DecorativeGlowLayer variant="landing" />

      {/* ── Nav ───────────────────────────────────────── */}
      <nav className="flex items-center justify-between px-8 py-3 sticky top-0 z-40"
        style={{
          background: C.navBg,
          backdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${C.border}`,
        }}>
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="transition-opacity hover:opacity-70">
          <img src={synapicLogo} alt="Synapic" className="h-16 w-auto object-contain" />
        </button>

        <div className="flex gap-1 p-1 rounded-full"
          style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
          {APP_TABS.map(t => (
            <motion.button key={t.id} onClick={() => onSelectTab(t.id)}
              className="px-4 py-2 rounded-full text-sm font-semibold transition-all relative"
              style={activeTab === t.id
                ? { color: 'white' }
                : { color: C.textMuted, background: 'transparent' }
              }>
              {activeTab === t.id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 rounded-full"
                  style={{ background: C.accentGrad }}
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </motion.button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm hidden md:block" style={{ color: C.textMuted }}>
                {user.email.split('@')[0]}
              </span>
              <button onClick={onSignOut}
                className="px-4 py-2 rounded-full text-sm font-semibold border transition-all hover:opacity-80"
                style={{ color: C.textMuted, borderColor: C.border, background: C.bg }}>
                Sign Out
              </button>
            </>
          ) : (
            <>
              <button onClick={() => onAuth('signin')}
                className="px-4 py-2 rounded-full text-sm font-semibold border transition-all hover:opacity-80"
                style={{ color: C.textMuted, borderColor: C.border, background: C.bg }}>
                Sign In
              </button>
              <button onClick={() => onAuth('signup')}
                className="px-4 py-2 rounded-full text-sm font-bold text-white transition-all hover:opacity-90"
                style={{ background: C.accentGrad, boxShadow: `0 4px 16px ${C.accent}30` }}>
                Sign Up Free
              </button>
            </>
          )}
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────── */}
      <div ref={heroRef} style={{
        position: 'relative', minHeight: '92vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
        padding: '60px 24px',
      }}>
        {/* Particle canvas behind everything */}
        <ParticleCanvas />

        {/* Soft vignette so particles fade at edges */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
          background: `radial-gradient(ellipse 80% 60% at 50% 50%, transparent 30%, ${C.bg} 100%)`,
        }} />

        {/* Content - moves up on scroll (parallax) */}
        <motion.div style={{ y: heroY, opacity: heroOpacity, position: 'relative', zIndex: 3 }}
          className="flex flex-col items-center text-center">

          {/* Top claim */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            style={{
              marginBottom: '18px',
              padding: '9px 16px',
              borderRadius: '999px',
              background: C.accentLight,
              border: `1px solid ${C.accent}30`,
              fontFamily: '"Segoe UI", Arial, Helvetica, sans-serif',
              fontSize: '13px',
              fontWeight: 800,
              lineHeight: 1,
              color: C.accent,
              letterSpacing: 0,
            }}>
            AI-Powered Learning Platform
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            style={{
              fontSize: 'clamp(46px, 7.8vw, 92px)',
              fontWeight: 850,
              lineHeight: 1.02,
              letterSpacing: 0,
              color: C.text,
              maxWidth: '860px',
              marginBottom: '20px',
              fontFamily: '"Segoe UI", Arial, Helvetica, sans-serif',
            }}>
            #1 AI study tool for students
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
            style={{
              fontSize: '18px', color: C.textMuted,
              maxWidth: '620px', lineHeight: 1.65,
              marginBottom: '22px', letterSpacing: '0.01em',
              fontWeight: 600,
            }}>
            Paste your notes and instantly generate flashcards, quizzes, and summaries powered by AI.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
            style={{
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              justifyContent: 'center',
              marginBottom: '42px',
            }}>
            {['Paste notes', 'Generate study tools', 'Review faster'].map((step, idx) => (
              <div key={step} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 12px',
                borderRadius: '999px',
                background: C.bgCard,
                border: `1px solid ${C.border}`,
                boxShadow: `0 10px 30px ${C.text}0D`,
              }}>
                <span style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: idx === 0 ? C.accentGrad : C.accentLight,
                  color: idx === 0 ? 'white' : C.accent,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 900,
                }}>
                  {idx + 1}
                </span>
                <span style={{ color: C.text, fontSize: '13px', fontWeight: 800 }}>{step}</span>
              </div>
            ))}
          </motion.div>

          {/* CTA buttons */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55 }}
            style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <motion.button onClick={onEnter}
              whileHover={{ scale: 1.04, boxShadow: `0 12px 40px ${C.accent}50` }}
              whileTap={{ scale: 0.97 }}
              style={{
                padding: '16px 36px', borderRadius: '100px',
                background: C.accentGrad, border: 'none',
                fontSize: '15px', fontWeight: 800, color: 'white', cursor: 'pointer',
                letterSpacing: '0.01em',
                boxShadow: `0 8px 32px ${C.accent}40`,
                transition: 'box-shadow 0.3s',
              }}>
              Start Studying Free
            </motion.button>
            <button onClick={scrollToWhatSynapicDoes} style={{
              padding: '16px 28px', borderRadius: '100px',
              background: 'transparent', border: `1.5px solid ${C.borderStrong}`,
              fontSize: '15px', fontWeight: 600, color: C.textMuted, cursor: 'pointer',
              transition: 'border-color 0.2s, color 0.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderStrong; e.currentTarget.style.color = C.textMuted }}>
              See how it works
            </button>
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.62 }}
            style={{ fontSize: '13px', color: C.textMuted, fontWeight: 700, marginBottom: '56px' }}>
            Free to start. No credit card required.
          </motion.p>

          {/* Live flashcard preview */}
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.65, ease: [0.16, 1, 0.3, 1] }}>
            <MockCard />
          </motion.div>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          style={{ position: 'absolute', bottom: '32px', left: '50%', transform: 'translateX(-50%)', zIndex: 3 }}>
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: C.textLight, fontWeight: 600 }}>
              Scroll
            </span>
            <div style={{ width: '1px', height: '32px', background: `linear-gradient(to bottom, ${C.accent}, transparent)` }} />
          </motion.div>
        </motion.div>
      </div>

      {/* ── Features section ──────────────────────────── */}
      {/* Product demo section */}
      <div style={{ position: 'relative', zIndex: 1 }}>
      <ScrollReveal>
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '96px 40px 48px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '28px', alignItems: 'stretch' }}>
            <div style={{
              background: C.bgCard,
              border: `1px solid ${C.border}`,
              borderRadius: '18px',
              padding: '28px',
              boxShadow: '0 18px 55px rgba(26,26,24,0.05)',
            }}>
              <p style={{ fontSize: '11px', fontWeight: 850, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.textLight, marginBottom: '18px' }}>
                Your notes
              </p>
              <p style={{ fontSize: '15px', color: C.text, lineHeight: 1.8, fontWeight: 600 }}>
                Cellular respiration turns glucose into ATP. It starts with glycolysis, continues through the Krebs cycle, and produces most ATP during oxidative phosphorylation.
              </p>
            </div>
            <div style={{
              background: C.bgCard,
              border: `1px solid ${C.border}`,
              borderRadius: '18px',
              padding: '28px',
              boxShadow: '0 18px 55px rgba(26,26,24,0.05)',
            }}>
              <p style={{ fontSize: '11px', fontWeight: 850, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.accent, marginBottom: '18px' }}>
                Synapic output
              </p>
              <div style={{ display: 'grid', gap: '12px' }}>
                {demoOutputs.map(item => (
                  <div key={item.label} style={{ padding: '14px', borderRadius: '14px', background: item.label === 'Flashcard' ? C.accentLight : C.bg, border: `1px solid ${item.label === 'Flashcard' ? `${C.accent}35` : C.border}` }}>
                    <p style={{ fontSize: '10px', fontWeight: 900, color: item.label === 'Flashcard' ? C.accent : C.textLight, textTransform: 'uppercase', marginBottom: '6px' }}>
                      {item.label}
                    </p>
                    <p style={{ fontSize: '13px', color: C.text, lineHeight: 1.45, fontWeight: 700 }}>
                      {item.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollReveal>

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '72px 40px 120px' }}>

        <ScrollReveal>
          <div ref={whatSynapicDoesRef} style={{ marginBottom: '72px', maxWidth: '600px', scrollMarginTop: '96px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: C.accent, marginBottom: '16px' }}>
              What Synapic does
            </p>
            <h2 style={{ fontSize: 'clamp(32px, 5vw, 52px)', fontWeight: 900, letterSpacing: '-0.025em', lineHeight: 1.1, color: C.text, marginBottom: '20px' }}>
              Three tools.<br />One paste.
            </h2>
            <p style={{ fontSize: '17px', color: C.textMuted, lineHeight: 1.7 }}>
              Paste your lecture notes once. Get a full study kit in seconds.
            </p>
          </div>
        </ScrollReveal>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
          {features.map((f, i) => (
            <ScrollReveal key={f.title} delay={i * 0.1}>
              <motion.div
                whileHover={{ y: -6, boxShadow: '0 20px 60px rgba(0,0,0,0.08)' }}
                transition={{ duration: 0.3 }}
                style={{
                  background: C.bgCard,
                  border: `1px solid ${C.border}`,
                  borderRadius: '20px',
                  padding: '36px 32px',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.3s',
                }}
                onClick={onEnter}>
                {/* Number accent */}
                <p style={{ fontSize: '48px', fontWeight: 900, color: `${C.accent}20`, letterSpacing: '-0.04em', lineHeight: 1, marginBottom: '20px' }}>
                  0{i + 1}
                </p>
                <h3 style={{ fontSize: '20px', fontWeight: 800, color: C.text, marginBottom: '12px', letterSpacing: '-0.01em' }}>
                  {f.title}
                </h3>
                <p style={{ fontSize: '14px', color: C.textMuted, lineHeight: 1.7 }}>
                  {f.desc}
                </p>
                <div style={{ marginTop: '28px', padding: '16px', borderRadius: '16px', background: C.bg, border: `1px solid ${C.border}` }}>
                  {renderFeaturePreview(f.preview)}
                </div>
              </motion.div>
            </ScrollReveal>
          ))}
        </div>
      </div>

      {/* ── Social proof strip ────────────────────────── */}
      <ScrollReveal>
        <div style={{
          borderTop: `1px solid ${C.border}`,
          borderBottom: `1px solid ${C.border}`,
          padding: '48px 40px',
          display: 'flex', justifyContent: 'center', gap: '80px', flexWrap: 'wrap',
        }}>
          {[
            { stat: '10,000+', label: 'Flashcards generated' },
            { stat: '< 10s', label: 'Average generation time' },
            { stat: '3 tools', label: 'One paste away' },
          ].map(s => (
            <div key={s.stat} style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '36px', fontWeight: 900, color: C.text, letterSpacing: '-0.03em', lineHeight: 1 }}>
                {s.stat}
              </p>
              <p style={{ fontSize: '13px', color: C.textMuted, marginTop: '8px', letterSpacing: '0.02em' }}>
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </ScrollReveal>

      {/* Mission section */}
      <ScrollReveal>
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '96px 40px 72px' }}>
          <p style={{
            fontSize: '12px',
            fontWeight: 900,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: C.accent,
            textAlign: 'center',
            marginBottom: '24px',
          }}>
            Built by students, for students
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '48px',
            alignItems: 'center',
            borderTop: `1px solid ${C.border}`,
            borderBottom: `1px solid ${C.border}`,
            padding: '56px 0',
          }}>
            <div>
              <p style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.accent, marginBottom: '14px' }}>
                Our Mission
              </p>
              <h2 style={{ fontSize: 'clamp(30px, 4vw, 46px)', fontWeight: 900, letterSpacing: '-0.025em', lineHeight: 1.08, color: C.text }}>
                Better studying, less friction.
              </h2>
            </div>
            <p style={{ fontSize: 'clamp(18px, 2.2vw, 24px)', color: C.text, lineHeight: 1.55, fontWeight: 650, letterSpacing: '-0.01em' }}>
              At Synapic, we want you to have the best studying experience possible. The future is here, with AI, becoming a straight-A student has never been easier.
            </p>
          </div>
        </div>
      </ScrollReveal>

      {/* Testimonials section */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '48px 40px 120px' }}>
        <ScrollReveal>
          <div style={{ textAlign: 'center', maxWidth: '680px', margin: '0 auto 48px' }}>
            <p style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.accent, marginBottom: '14px' }}>
              Testimonials
            </p>
            <h2 style={{ fontSize: 'clamp(34px, 5vw, 56px)', fontWeight: 900, letterSpacing: '-0.03em', color: C.text, lineHeight: 1.08, marginBottom: '18px' }}>
              Loved by students
            </h2>
            <p style={{ fontSize: '17px', color: C.textMuted, lineHeight: 1.7 }}>
              Don't just take our word for it. Here's what the community is saying.
            </p>
          </div>
        </ScrollReveal>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
          {testimonials.map((t, i) => (
            <ScrollReveal key={t.name} delay={i * 0.08}>
              <motion.div
                whileHover={{ y: -6, boxShadow: '0 20px 60px rgba(0,0,0,0.08)' }}
                transition={{ duration: 0.3 }}
                style={{
                  height: '100%',
                  background: C.bgCard,
                  border: `1px solid ${C.border}`,
                  borderRadius: '20px',
                  padding: '30px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '28px',
                }}>
                <div>
                  <p aria-label="5 out of 5 stars" style={{ color: C.warning, fontSize: '18px', letterSpacing: '0.08em', marginBottom: '18px' }}>
                    ⭐⭐⭐⭐⭐
                  </p>
                  <p style={{ fontSize: '16px', color: C.text, lineHeight: 1.7, fontWeight: 600 }}>
                    "{t.quote}"
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{
                    width: '46px',
                    height: '46px',
                    borderRadius: '50%',
                    background: C.accentGrad,
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: 900,
                    letterSpacing: '0.04em',
                    boxShadow: `0 10px 28px ${C.accent}30`,
                    flex: '0 0 auto',
                  }}>
                    {t.initials}
                  </div>
                  <div>
                    <p style={{ fontSize: '15px', fontWeight: 800, color: C.text, marginBottom: '3px' }}>
                      {t.name}
                    </p>
                    <p style={{ fontSize: '13px', color: C.textMuted }}>
                      {t.role}
                    </p>
                  </div>
                </div>
              </motion.div>
            </ScrollReveal>
          ))}
        </div>
      </div>

      <ScrollReveal>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '8px 40px 80px' }}>
          <div style={{ textAlign: 'center', marginBottom: '36px' }}>
            <p style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.accent, marginBottom: '12px' }}>
              FAQ
            </p>
            <h2 style={{ fontSize: 'clamp(30px, 4vw, 44px)', fontWeight: 900, color: C.text, lineHeight: 1.12 }}>
              Quick answers
            </h2>
          </div>
          <div style={{ display: 'grid', gap: '12px' }}>
            {faqs.map(item => (
              <div key={item.q} style={{
                background: C.bgCard,
                border: `1px solid ${C.border}`,
                borderRadius: '16px',
                padding: '22px 24px',
              }}>
                <h3 style={{ fontSize: '16px', fontWeight: 850, color: C.text, marginBottom: '8px' }}>
                  {item.q}
                </h3>
                <p style={{ fontSize: '14px', color: C.textMuted, lineHeight: 1.65, fontWeight: 600 }}>
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </ScrollReveal>

      <ScrollReveal>
        <div style={{ padding: '140px 40px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(36px, 6vw, 64px)', fontWeight: 900, letterSpacing: '-0.03em', color: C.text, marginBottom: '24px', lineHeight: 1.08 }}>
            Ready to study smarter?
          </h2>
          <p style={{ fontSize: '17px', color: C.textMuted, maxWidth: '400px', margin: '0 auto 48px', lineHeight: 1.65 }}>
            No account required. Paste your notes and generate your first deck in under 10 seconds.
          </p>
          <motion.button onClick={onEnter}
            animate={{
              scale: [1, 1.07, 1],
              boxShadow: [
                `0 8px 32px ${C.accent}40`,
                `0 22px 70px ${C.accent}75`,
                `0 8px 32px ${C.accent}40`,
              ],
            }}
            transition={{
              duration: 1.35,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            whileHover={{ scale: 1.04, boxShadow: `0 16px 48px ${C.accent}50` }}
            whileTap={{ scale: 0.97 }}
            style={{
              padding: '18px 48px', borderRadius: '100px',
              background: C.accentGrad, border: 'none',
              fontSize: '16px', fontWeight: 800, color: 'white', cursor: 'pointer',
              boxShadow: `0 8px 32px ${C.accent}40`,
              letterSpacing: '0.01em',
            }}>
            Start for free
          </motion.button>
        </div>
      </ScrollReveal>

      {/* Footer */}
      <div style={{
        borderTop: `1px solid ${C.border}`,
        padding: '32px 40px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <img src={synapicLogo} alt="Synapic" style={{ height: '40px', width: 'auto', objectFit: 'contain', opacity: 0.6 }} />
        <p style={{ fontSize: '13px', color: C.textLight }}>
          Built by Shyam - University of Auckland
        </p>
      </div>

      {/* Pulse animation keyframe */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>
      </div>
    </div>
  )
}

// ── Toast ────────────────────────────────────────────────────
function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className="fixed bottom-6 right-6 px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium z-50 flex items-center gap-3"
      style={{
        background: C.bgCard,
        color: C.text,
        border: `1px solid ${C.borderStrong}`,
        boxShadow: `0 18px 50px rgba(0,0,0,0.22), 0 0 0 1px ${C.accent}12`,
        maxWidth: '320px',
      }}>
      <span style={{
        width: '9px',
        height: '9px',
        borderRadius: '50%',
        background: C.accent,
        boxShadow: `0 0 0 4px ${C.accent}20`,
        flex: '0 0 auto',
      }} />
      <span className="flex-1">{message}</span>
      <button
        onClick={onClose}
        className="opacity-60 hover:opacity-100 text-lg leading-none"
        style={{ color: C.textMuted }}>
        x
      </button>
    </motion.div>
  )
}

// ── Skeleton ─────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="rounded-2xl p-6 min-h-36 animate-pulse"
      style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
      <div className="h-3 w-16 rounded-full mb-4" style={{ background: C.border }} />
      <div className="h-4 w-full rounded-full mb-2" style={{ background: C.border }} />
      <div className="h-4 w-2/3 rounded-full" style={{ background: C.border }} />
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────
function EmptyState({ icon, title, subtitle }) {
  return (
    <motion.div {...fadeUp}
      className="rounded-2xl p-16 text-center"
      style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
      {icon && <p className="text-5xl mb-4">{icon}</p>}
      <p className="font-bold text-lg mb-2" style={{ color: C.text }}>{title}</p>
      <p className="text-sm" style={{ color: C.textMuted }}>{subtitle}</p>
    </motion.div>
  )
}

// ── Upgrade Prompt Modal ──────────────────────────────────────
function UpgradePrompt({ onSignUp, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 20 }}
        transition={{ duration: 0.25 }}
        className="rounded-3xl p-8 max-w-md w-full text-center shadow-2xl"
        style={{ background: C.bgCard, border: `1px solid ${C.border}` }}
        onClick={e => e.stopPropagation()}>
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4 text-sm font-black"
          style={{ background: C.accentLight, color: C.accentDark }}>
          PRO
        </div>
        <h2 className="text-2xl font-black mb-2" style={{ color: C.text }}>
          You've used your {FREE_GENERATION_LIMIT} free generations
        </h2>
        <p className="text-sm mb-6 leading-relaxed" style={{ color: C.textMuted }}>
          Create a free account to get much higher daily limits for flashcards, quizzes, and summaries, plus save your decks forever.
        </p>
        <div className="rounded-2xl p-4 mb-6 text-left space-y-2"
          style={{ background: C.accentLight, border: `1px solid ${C.accent}30` }}>
          {[
            'Much higher daily generation limits',
            'Paste notes up to 100,000 characters (guests: 12,000)',
            'Save and revisit your decks',
            'Free forever - no credit card'
          ].map(item => (
            <p key={item} className="text-sm font-medium" style={{ color: C.accentDark }}>{item}</p>
          ))}
        </div>
        <motion.button onClick={onSignUp}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="w-full py-3 rounded-full font-bold text-white text-sm mb-3"
          style={{ background: C.accentGrad, boxShadow: `0 8px 24px ${C.accent}40` }}>
          Create Free Account
        </motion.button>
        <button onClick={onClose} className="text-xs hover:opacity-70 transition-opacity"
          style={{ color: C.textLight }}>
          Maybe later
        </button>
      </motion.div>
    </motion.div>
  )
}

// ── Main App ─────────────────────────────────────────────────
export default function App() {
  const shouldReduceMotion = useReducedMotion()
  const [page, setPage] = useState('landing')
  const [authMode, setAuthMode] = useState('signin')
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [tab, setTab] = useState('flashcards')
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('synapic_dark_mode') === 'true'
  })
  const [notes, setNotes] = useState('')
  const [flashcards, setFlashcards] = useState([])
  const [quiz, setQuiz] = useState(null)
  const [quizAnswers, setQuizAnswers] = useState({})
  const [quizSubmitted, setQuizSubmitted] = useState(false)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [flipped, setFlipped] = useState({})
  const [currentCard, setCurrentCard] = useState(0)
  const [studyMode, setStudyMode] = useState('grid')
  const [toast, setToast] = useState(null)
  const [savedDecks, setSavedDecks] = useState([])
  const [decksLoading, setDecksLoading] = useState(false)
  const [deckStats, setDeckStats] = useState({ totalCards: 0 })
  const [deckName, setDeckName] = useState('')
  const [studyStreak, setStudyStreak] = useState({ count: 0, lastStudiedDate: null })
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)

  C = darkMode ? DARK_THEME : LIGHT_THEME

  const goToStudyCard = useCallback((nextCard) => {
    if (nextCard === currentCard) return
    setFlipped(prev => ({
      ...prev,
      [nextCard]: false,
    }))
    setCurrentCard(nextCard)
  }, [currentCard])

  const [guestGenerations, setGuestGenerations] = useState(() => {
    const saved = localStorage.getItem('synapic_guest_generations')
    const parsed = saved ? parseInt(saved, 10) : 0
    return Number.isNaN(parsed) ? 0 : parsed
  })

  useEffect(() => {
    localStorage.setItem('synapic_dark_mode', darkMode.toString())
    document.body.style.backgroundColor = C.bg
    document.body.style.color = C.text
  }, [darkMode])

  // ── Auth listener ─────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
      if (session?.user) {
        localStorage.removeItem('synapic_guest_generations')
        setGuestGenerations(0)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // ── Keyboard shortcuts for study mode ────────────────────
  useEffect(() => {
    const handler = e => {
      if (flashcards.length === 0 || studyMode !== 'study') return
      if (e.key === 'ArrowRight') goToStudyCard(Math.min(currentCard + 1, flashcards.length - 1))
      if (e.key === 'ArrowLeft') goToStudyCard(Math.max(currentCard - 1, 0))
      if (e.key === ' ') {
        e.preventDefault()
        setFlipped(prev => ({ ...prev, [currentCard]: !prev[currentCard] }))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [flashcards, studyMode, currentCard, goToStudyCard])

  // ── Guest generation helpers ──────────────────────────────
  const incrementGuestGenerations = () => {
    const next = guestGenerations + 1
    setGuestGenerations(next)
    localStorage.setItem('synapic_guest_generations', next.toString())
  }

  // ── Generate ──────────────────────────────────────────────
  const getStudyStreakStorageKey = useCallback(() => {
    return user ? `synapic_study_streak_${user.id}` : null
  }, [user])

  useEffect(() => {
    const storageKey = getStudyStreakStorageKey()
    if (!storageKey) {
      setStudyStreak({ count: 0, lastStudiedDate: null })
      return
    }

    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
      const today = getLocalDateKey()
      const hasExpired = saved.lastStudiedDate && daysBetweenDateKeys(saved.lastStudiedDate, today) > 1
      setStudyStreak({
        count: hasExpired ? 0 : saved.count || 0,
        lastStudiedDate: saved.lastStudiedDate || null,
      })
    } catch {
      setStudyStreak({ count: 0, lastStudiedDate: null })
    }
  }, [getStudyStreakStorageKey])

  const recordStudySession = useCallback(() => {
    const storageKey = getStudyStreakStorageKey()
    if (!storageKey) return

    const today = getLocalDateKey()
    setStudyStreak(prev => {
      if (prev.lastStudiedDate === today) return prev

      const gap = daysBetweenDateKeys(prev.lastStudiedDate, today)
      const next = {
        count: gap === 1 ? prev.count + 1 : 1,
        lastStudiedDate: today,
      }
      localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  }, [getStudyStreakStorageKey])

  const currentInputLimit = user ? MAX_INPUT_CHARS : GUEST_MAX_INPUT_CHARS

  const generate = async () => {
    if (!notes.trim()) return

    if (notes.length > currentInputLimit) {
      setToast(`Text too long (${notes.length.toLocaleString()} chars). Keep it under ${currentInputLimit.toLocaleString()} characters.`)
      return
    }

      // ── Guest generation limit check ─────────────────────────────
    if (!user && guestGenerations >= FREE_GENERATION_LIMIT) {
      setShowUpgradePrompt(true) //show the sign-up model instead
      return
    }

    setLoading(true)
    setFlashcards([])
    setQuiz(null)
    setSummary(null)
    setFlipped({})
    setCurrentCard(0)
    setQuizAnswers({})
    setQuizSubmitted(false)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const requestConfig = session?.access_token
        ? { headers: { Authorization: `Bearer ${session.access_token}` } }
        : undefined

      if (tab === 'flashcards') {
        const res = await axios.post(`${import.meta.env.VITE_API_URL}/generate-flashcards`, { text: notes }, requestConfig)
        setFlashcards(res.data.flashcards)
        setDeckName(makeDefaultDeckTitle(notes))
        setToast(`Generated ${res.data.flashcards.length} flashcards`)
      } else if (tab === 'quizzes') {
        const res = await axios.post(`${import.meta.env.VITE_API_URL}/generate-quiz`, { text: notes }, requestConfig)
        setQuiz(res.data.quiz)
        setToast(`Generated ${res.data.quiz.length} questions`)
      } else if (tab === 'summary') {
        const res = await axios.post(`${import.meta.env.VITE_API_URL}/generate-summary`, { text: notes }, requestConfig)
        setSummary(res.data)
        setToast('Summary generated')
      }

      if (!user) incrementGuestGenerations()

    } catch (err) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail
      if (status === 400 && detail?.error === 'text_too_long') {
        setToast(detail.message)
      } else if (status === 429) {
        setToast(detail?.message || 'Rate limit reached - wait ~60 seconds and try again.')
      } else if (status === 413) {
        setToast('That text is too large to send.')
      } else {
        setToast('Something went wrong. Is the backend running?')
      }
    }
    setLoading(false)
  }



  // ── Save deck ─────────────────────────────────────────────
  const saveDeck = async () => {
    if (!user || flashcards.length === 0) return
    try {
      const customTitle = deckName.trim()
      const title = customTitle || makeDefaultDeckTitle(notes)
      const { data: deck, error: deckError } = await supabase
        .from('decks').insert({ user_id: user.id, title }).select().single()
      if (deckError) throw deckError
      const cardRows = flashcards.map(card => ({
        deck_id: deck.id, question: card.question, answer: card.answer
      }))
      const { error: cardsError } = await supabase.from('flashcards').insert(cardRows)
      if (cardsError) throw cardsError
      setSavedDecks(prev => [deck, ...prev.filter(savedDeck => savedDeck.id !== deck.id)])
      setDeckStats(prev => ({ totalCards: prev.totalCards + flashcards.length }))
      setToast(`"${title}" saved!`)
    } catch {
      setToast('Failed to save deck. Please try again.')
    }
  }

  // ── Load decks ────────────────────────────────────────────
  const loadDecks = useCallback(async () => {
    if (!user) return
    setDecksLoading(true)
    try {
      const { data, error } = await supabase
        .from('decks').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
      if (error) throw error
      setSavedDecks(data)

      // Load total card count for the stats row
      const { count } = await supabase
        .from('flashcards')
        .select('id', { count: 'exact', head: true })
        .in('deck_id', data.map(d => d.id))
      setDeckStats({ totalCards: count || 0 })
    } catch (err) {
      console.error(err)
    }
    setDecksLoading(false)
  }, [user])

  useEffect(() => {
    if (tab === 'decks') loadDecks()
  }, [tab, loadDecks])

  const openAuth = (mode = 'signin') => {
    setAuthMode(mode)
    setPage('auth')
  }

  // ── Auth loading screen ───────────────────────────────────
  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{ borderColor: C.accent, borderTopColor: 'transparent' }} />
        <p className="text-sm" style={{ color: C.textMuted }}>Loading...</p>
      </div>
    </div>
  )

  if (page === 'landing') return (
    <Landing
      onEnter={() => setPage('app')}
      activeTab={null}
      onSelectTab={(nextTab) => {
        if (nextTab === 'decks' && !user) {
          openAuth('signin')
          return
        }
        setTab(nextTab)
        setPage('app')
      }}
      onAuth={openAuth}
      user={user}
      onSignOut={() => supabase.auth.signOut()}
    />
  )

  if (page === 'auth') return (
    <Authentication
      onLogin={() => setPage('app')}
      onBack={() => setPage('landing')}
      initialMode={authMode}
    />
  )

  const headings = {
    flashcards: 'Create Study Materials',
    quizzes: 'Create Study Materials',
    summary: 'Create Study Materials',
  }

  const subheadings = {
    flashcards: 'Transform your dense lecture notes into interactive flashcards in seconds using our scholarly AI engine.',
    quizzes: 'Transform your dense lecture notes into a multiple-choice quiz to test your knowledge.',
    summary: 'Transform your dense lecture notes into a clean, structured summary in seconds.',
  }

  const inputNotes = {
    flashcards: 'More notes create more flashcards, so larger inputs take longer to generate.',
    quizzes: 'More notes create more quiz questions, so larger inputs take longer to generate.',
    summary: 'More notes create a longer summary, so larger inputs take longer to generate.',
  }

  const btnLabels = {
    flashcards: 'Generate Flashcards',
    quizzes: 'Generate Quiz',
    summary: 'Summarise Notes',
  }

  return (
    <div className="min-h-screen" style={{ background: C.bg, position: 'relative', overflow: 'hidden', isolation: 'isolate' }}>
      <DecorativeGlowLayer variant="study" />

      {/* Toast */}
      <AnimatePresence>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </AnimatePresence>

      {/* Upgrade prompt */}
      <AnimatePresence>
        {showUpgradePrompt && (
          <UpgradePrompt
            onSignUp={() => { setShowUpgradePrompt(false); openAuth('signup') }}
            onClose={() => setShowUpgradePrompt(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Nav ──────────────────────────────────────────── */}
      <nav className="flex items-center justify-between px-8 py-3 sticky top-0 z-40"
        style={{
          background: C.navBg,
          backdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${C.border}`
        }}>
        <button onClick={() => setPage('landing')} className="transition-opacity hover:opacity-70">
          <img src={synapicLogo} alt="Synapic" className="h-16 w-auto object-contain" />
        </button>

        {/* Tab switcher - pill style matching Image 2 */}
        <div className="flex gap-1 p-1 rounded-full"
          style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
          {APP_TABS.map(t => (
            <motion.button key={t.id} onClick={() => t.id === 'decks' && !user ? openAuth('signin') : setTab(t.id)}
              className="px-4 py-2 rounded-full text-sm font-semibold transition-all relative"
              style={tab === t.id
                ? { color: 'white' }
                : { color: C.textMuted, background: 'transparent' }
              }>
              {/* Animated active background */}
              {tab === t.id && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 rounded-full"
                  style={{ background: C.accentGrad }}
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </motion.button>
          ))}
        </div>

        {/* User + sign out */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <span className="text-sm hidden md:block" style={{ color: C.textMuted }}>
                {user.email.split('@')[0]}
              </span>
              <button onClick={() => supabase.auth.signOut()}
                className="px-4 py-2 rounded-full text-sm font-semibold border transition-all hover:opacity-80"
                style={{ color: C.textMuted, borderColor: C.border, background: C.bg }}>
                Sign Out
              </button>
            </>
          ) : (
            <>
              <button onClick={() => openAuth('signin')}
                className="px-4 py-2 rounded-full text-sm font-semibold border transition-all hover:opacity-80"
                style={{ color: C.textMuted, borderColor: C.border, background: C.bg }}>
                Sign In
              </button>
              <button onClick={() => openAuth('signup')}
                className="px-4 py-2 rounded-full text-sm font-bold text-white transition-all hover:opacity-90"
                style={{ background: C.accentGrad, boxShadow: `0 4px 16px ${C.accent}30` }}>
                Sign Up Free
              </button>
            </>
          )}
        </div>
      </nav>

      {/* ── Main content ─────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-6 py-10 relative z-10">

        {/* Input section - only show on non-decks tabs */}
        <AnimatePresence mode="wait">
          {!['decks', 'settings'].includes(tab) && (
            <motion.div key="input-section" {...fadeUp}
              className="rounded-3xl p-8 mb-8 shadow-sm"
              style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>

              {/* Heading */}
              <h2 className="text-3xl font-black mb-2" style={{ color: C.text }}>
                {headings[tab]}
              </h2>
              <p className="text-sm mb-5 leading-relaxed" style={{ color: C.textMuted }}>
                {subheadings[tab]}
              </p>

              {inputNotes[tab] && (
                <div
                  className="mb-5 rounded-2xl px-4 py-3 text-sm leading-relaxed"
                  style={{
                    background: darkMode ? 'rgba(251,191,36,0.12)' : '#FFF8E8',
                    border: `1px solid ${C.warning}45`,
                    color: darkMode ? '#FDE68A' : '#8A5A00',
                  }}>
                  <span className="font-bold">Generation note: </span>
                  {inputNotes[tab]}
                </div>
              )}

              {/* Guest usage banner - matches Image 2 pill badge */}
              {!user && (
                <motion.div
                  animate={{ scale: [1, 1.01, 1] }}
                  transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold mb-5 cursor-pointer"
                  style={{
                    background: guestGenerations >= FREE_GENERATION_LIMIT ? C.dangerLight : C.accentLight,
                    color: guestGenerations >= FREE_GENERATION_LIMIT ? C.danger : C.accentDark,
                    border: `1px solid ${guestGenerations >= FREE_GENERATION_LIMIT ? C.danger : C.accent}30`
                  }}
                  onClick={() => openAuth('signup')}>
                  {guestGenerations >= FREE_GENERATION_LIMIT
                    ? 'No free generations left. Sign up free for higher daily limits!'
                    : `${FREE_GENERATION_LIMIT - guestGenerations} free generation${FREE_GENERATION_LIMIT - guestGenerations === 1 ? '' : 's'} remaining`
                  }
                </motion.div>
              )}

              {!user && (
                <p className="text-xs -mt-3 mb-5" style={{ color: C.textMuted }}>
                  Free account: notes up to 100,000 characters and much higher daily limits.
                </p>
              )}

              {/* Textarea */}
              <textarea
                className="w-full h-44 rounded-2xl p-4 text-sm resize-none focus:outline-none transition-all"
                style={{
                  background: C.bg,
                  border: `1.5px solid ${C.border}`,
                  color: C.text,
                }}
                onFocus={e => e.target.style.borderColor = C.accent}
                onBlur={e => e.target.style.borderColor = C.border}
                placeholder="Paste your lecture notes or textbook chapters here..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />

              {!user && notes.length > GUEST_MAX_INPUT_CHARS && (
                <p className="mt-2 text-xs" style={{ color: C.danger }}>
                  Sign up free to paste up to 100,000 characters.{' '}
                  <button
                    onClick={() => openAuth('signup')}
                    className="font-bold hover:underline"
                    style={{ color: C.accent }}>
                    Sign up free
                  </button>
                </p>
              )}

              {/* Footer row: char counter + generate button */}
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs"
                    style={{
                      color: notes.length > currentInputLimit ? C.danger : C.textLight,
                      fontWeight: notes.length > currentInputLimit ? '600' : 'normal'
                    }}>
                    {notes.length > 0
                      ? `${notes.length.toLocaleString()} / ${currentInputLimit.toLocaleString()} characters${notes.length > currentInputLimit ? ' - too long' : ''}`
                      : 'Supports plain text'}
                  </p>
                </div>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={generate}
                  disabled={loading || !notes.trim() || notes.length > currentInputLimit}
                  className="flex items-center gap-2 px-6 py-3 rounded-full font-bold text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: C.accentGrad, boxShadow: `0 4px 16px ${C.accent}30` }}>
                  {loading ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 animate-spin"
                        style={{ borderColor: 'rgba(255,255,255,0.4)', borderTopColor: 'white' }} />
                      Generating...
                    </>
                  ) : (
                    <>{btnLabels[tab]}</>
                  )}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings tab */}
        <AnimatePresence mode="wait">
          {tab === 'settings' && (
            <motion.div key="settings" {...fadeUp}>
              <div className="mb-6">
                <h2 className="text-3xl font-black mb-1" style={{ color: C.text }}>Settings</h2>
                <p className="text-sm" style={{ color: C.textMuted }}>Tune Synapic to your study style.</p>
              </div>

              <motion.div
                variants={cardVariant}
                initial="initial"
                animate="animate"
                className="rounded-2xl p-6 flex items-center justify-between gap-6"
                style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                <div>
                  <p className="font-bold text-base" style={{ color: C.text }}>Dark mode</p>
                  <p className="text-sm mt-1" style={{ color: C.textMuted }}>
                    Switch to a darker interface for late-night study sessions.
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={darkMode}
                  onClick={() => setDarkMode(value => !value)}
                  className="relative flex h-8 w-14 flex-shrink-0 items-center rounded-full p-1 transition-all"
                  style={{
                    background: darkMode ? C.accentGrad : C.bg,
                    border: `1px solid ${darkMode ? C.accent : C.borderStrong}`,
                  }}>
                  <motion.span
                    layout
                    className="block h-6 w-6 rounded-full shadow-sm"
                    style={{
                      background: darkMode ? '#FFFFFF' : C.bgCard,
                      x: darkMode ? 22 : 0,
                    }}
                    transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                  />
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Flashcards tab ───────────────────────────── */}
        <AnimatePresence mode="wait">
          {tab === 'flashcards' && (
            <motion.div key="flashcards" {...fadeUp}>

              {loading && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
                </div>
              )}

              {!loading && flashcards.length === 0 && (
                <EmptyState icon="" title="Ready to Make Flashcards?"
                  subtitle="Paste your notes above and hit generate." />
              )}

              {!loading && flashcards.length > 0 && (
                <div>
                  {/* Controls row */}
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-sm font-semibold" style={{ color: C.textMuted }}>
                        {flashcards.length} cards generated
                      </p>
                      {user && (
                        <div className="flex items-center gap-2">
                          <input
                            value={deckName}
                            onChange={e => setDeckName(e.target.value)}
                            maxLength={80}
                            aria-label="Saved deck name"
                            placeholder="Deck name"
                            className="w-44 px-3 py-1.5 rounded-full text-xs font-semibold outline-none transition-all"
                            style={{
                              background: C.bgCard,
                              color: C.text,
                              border: `1px solid ${C.border}`,
                            }}
                          />
                          <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                            onClick={saveDeck}
                            className="px-4 py-1.5 rounded-full text-xs font-bold transition-all"
                            style={{ background: C.accentLight, color: C.accent, border: `1px solid ${C.accent}30` }}>
                            Save Deck
                          </motion.button>
                        </div>
                      )}
                    </div>

                    {/* Grid / Study mode toggle - matches Image 3 toggle */}
                    <div className="flex items-center gap-2 p-1 rounded-full"
                      style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                      {['grid', 'study'].map(m => (
                        <button key={m} onClick={() => {
                          if (m === 'study') recordStudySession()
                          setStudyMode(m)
                        }}
                          className="px-4 py-2 rounded-full text-sm font-semibold capitalize transition-all relative"
                          style={studyMode === m
                            ? { background: C.accentGrad, color: 'white' }
                            : { color: C.textMuted }
                          }>
                          {m === 'grid' ? 'Grid View' : 'Study Mode'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Grid view */}
                  {studyMode === 'grid' && (
                    <motion.div
                      variants={staggerContainer}
                      initial="initial"
                      animate="animate"
                      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {flashcards.map((card, i) => (
                        <motion.div key={i} variants={cardVariant}
                          onClick={() => setFlipped(p => ({ ...p, [i]: !p[i] }))}
                          whileHover={shouldReduceMotion ? {} : { y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
                          style={{ perspective: '900px' }}>
                          <motion.div
                            animate={{ rotateY: flipped[i] ? 180 : 0 }}
                            transition={shouldReduceMotion ? { duration: 0 } : studyFlipTransition}
                            style={{
                              transformStyle: 'preserve-3d',
                              position: 'relative',
                              minHeight: '144px',
                              cursor: 'pointer',
                              willChange: 'transform',
                            }}>
                            {/* Front */}
                            <div style={{
                              backfaceVisibility: 'hidden',
                              WebkitBackfaceVisibility: 'hidden',
                              position: 'absolute', inset: 0,
                              background: C.bgCard,
                              border: `1px solid ${C.border}`,
                              borderRadius: '16px',
                              boxShadow: '0 2px 10px rgba(0,0,0,0.035)',
                              padding: '24px',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                            }}>
                              <p className="text-xs uppercase tracking-widest font-semibold"
                                style={{ color: C.textLight }}>Question</p>
                              <p className="text-sm font-medium leading-relaxed"
                                style={{ color: C.text }}>{card.question}</p>
                              <p className="text-xs" style={{ color: C.textLight }}>Click to flip</p>
                            </div>
                            {/* Back */}
                            <div style={{
                              backfaceVisibility: 'hidden',
                              WebkitBackfaceVisibility: 'hidden',
                              transform: 'rotateY(180deg)',
                              position: 'absolute', inset: 0,
                              background: C.accentLight,
                              border: `1px solid ${C.accent}45`,
                              borderRadius: '16px',
                              padding: '24px',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'space-between',
                            }}>
                              <p className="text-xs uppercase tracking-widest font-semibold"
                                style={{ color: C.accent }}>Answer</p>
                              <p className="text-sm font-medium leading-relaxed" style={{ color: C.text }}>{card.answer}</p>
                              <p className="text-xs" style={{ color: C.textLight }}>Click to flip back</p>
                            </div>
                          </motion.div>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}

                  {/* Study mode - matches Image 3 */}
                  {studyMode === 'study' && (
                    <motion.div {...fadeUp} className="flex flex-col items-center">

                      {/* Progress bar */}
                      <div className="w-full max-w-2xl mb-6">
                        <div className="flex justify-between text-xs mb-2" style={{ color: C.textMuted }}>
                          <span className="font-semibold uppercase tracking-widest">Daily Progress</span>
                          <span className="font-bold">{currentCard + 1} / {flashcards.length} Cards</span>
                        </div>
                        <div className="w-full h-2 rounded-full" style={{ background: C.border }}>
                          <motion.div
                            className="h-2 rounded-full"
                            style={{ background: C.accentGrad }}
                            initial={{ width: 0 }}
                            animate={{ width: `${((currentCard + 1) / flashcards.length) * 100}%` }}
                            transition={{ duration: 0.4, ease: 'easeOut' }}
                          />
                        </div>
                      </div>

                      {/* Big card with 3D flip */}
                      <div style={{ perspective: '1200px' }} className="w-full max-w-2xl mb-6">
                        <AnimatePresence mode="wait" initial={false}>
                          <motion.div
                            key={currentCard}
                            initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.995 }}
                            transition={shouldReduceMotion ? { duration: 0 } : {
                              opacity: cardSwapTransition.opacity,
                              y: cardSwapTransition.y,
                              scale: cardSwapTransition.scale,
                            }}
                            style={{
                              position: 'relative',
                              minHeight: '280px',
                              willChange: 'transform',
                            }}>
                            <motion.div
                              animate={{ rotateY: flipped[currentCard] ? 180 : 0 }}
                              transition={shouldReduceMotion ? { duration: 0 } : studyFlipTransition}
                              style={{
                                transformStyle: 'preserve-3d',
                                position: 'absolute',
                                inset: 0,
                                willChange: 'transform',
                              }}>
                              {/* Front */}
                              <div
                                onClick={() => setFlipped(p => ({ ...p, [currentCard]: !p[currentCard] }))}
                                style={{
                                  backfaceVisibility: 'hidden',
                                  WebkitBackfaceVisibility: 'hidden',
                                  position: 'absolute', inset: 0,
                                  background: C.bgCard,
                                  border: `1px solid ${C.border}`,
                                  borderRadius: '24px',
                                  boxShadow: '0 8px 28px rgba(0,0,0,0.055)',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: '48px',
                                  textAlign: 'center',
                                }}>
                                <p className="text-xs uppercase tracking-widest mb-5 font-semibold"
                                  style={{ color: C.textLight }}>Question</p>
                                <p className="text-xl font-bold leading-relaxed"
                                  style={{ color: C.text }}>
                                  {flashcards[currentCard].question}
                                </p>
                              </div>
                              {/* Back */}
                              <div
                                onClick={() => setFlipped(p => ({ ...p, [currentCard]: !p[currentCard] }))}
                                style={{
                                  backfaceVisibility: 'hidden',
                                  WebkitBackfaceVisibility: 'hidden',
                                  transform: 'rotateY(180deg)',
                                  position: 'absolute', inset: 0,
                                  background: C.accentLight,
                                  border: `1px solid ${C.accent}55`,
                                  borderRadius: '24px',
                                  boxShadow: '0 8px 28px rgba(0,0,0,0.055)',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: '48px',
                                  textAlign: 'center',
                                }}>
                                <p className="text-xs uppercase tracking-widest mb-5 font-semibold"
                                  style={{ color: C.accent }}>Answer</p>
                                <p className="text-xl font-bold leading-relaxed" style={{ color: C.text }}>
                                  {flashcards[currentCard].answer}
                                </p>
                              </div>
                            </motion.div>
                          </motion.div>
                        </AnimatePresence>
                      </div>

                      {/* Previous / Next - matches Image 3 */}
                      <div className="flex flex-wrap items-center justify-center gap-2 text-xs mb-4"
                        style={{ color: C.textLight }}>
                        <span>Click to flip</span>
                        <span>/</span>
                        <span>Space</span>
                        <span>/</span>
                        <span>Arrow keys to navigate</span>
                      </div>

                      <div className="flex gap-3">
                        <motion.button whileHover={shouldReduceMotion ? {} : { y: -1 }} whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
                          onClick={() => goToStudyCard(Math.max(currentCard - 1, 0))}
                          disabled={currentCard === 0}
                          className="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-semibold transition-all disabled:opacity-30"
                          style={{ background: C.bgCard, color: C.text, border: `1px solid ${C.border}` }}>
                          Previous
                        </motion.button>
                        <motion.button whileHover={shouldReduceMotion ? {} : { y: -1 }} whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
                          onClick={() => goToStudyCard(Math.min(currentCard + 1, flashcards.length - 1))}
                          disabled={currentCard === flashcards.length - 1}
                          className="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-bold text-white transition-all disabled:opacity-30"
                          style={{ background: C.accentGrad }}>
                          Next
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Quizzes tab ──────────────────────────────── */}
        <AnimatePresence mode="wait">
          {tab === 'quizzes' && (
            <motion.div key="quizzes" {...fadeUp}>
              {loading && (
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
                </div>
              )}

              {!loading && !quiz && (
                <EmptyState icon="" title="Ready to Quiz Yourself?"
                  subtitle="Paste your notes above and hit generate." />
              )}

              {!loading && quiz && (
                <div className="space-y-5">
                  {/* Score badge - top right like Image 4 */}
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold" style={{ color: C.textMuted }}>
                      {quiz.length} questions
                    </p>
                    {quizSubmitted && (
                      <motion.div
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-black"
                        style={{ background: C.accentGrad, color: 'white' }}>
                        Score {Object.entries(quizAnswers).filter(([i, ans]) => ans === quiz[i].correct).length}/{quiz.length}
                      </motion.div>
                    )}
                  </div>

                  {quiz.map((q, i) => {
                    const userAnswer = quizAnswers[i]
                    const isCorrect = userAnswer === q.correct

                    return (
                      <motion.div key={i} variants={cardVariant}
                        initial="initial" animate="animate"
                        className="rounded-2xl p-6"
                        style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>

                        {/* Question header with correct/incorrect badge - matches Image 4 */}
                        <div className="flex items-start justify-between mb-4 gap-4">
                          <p className="font-bold text-base leading-relaxed"
                            style={{ color: C.text }}>
                            {i + 1}. {q.question}
                          </p>
                          {quizSubmitted && (
                            <span className="text-xs font-bold px-3 py-1 rounded-full flex-shrink-0 flex items-center gap-1"
                              style={{
                                background: isCorrect ? C.successLight : C.dangerLight,
                                color: isCorrect ? C.success : C.danger,
                              }}>
                              {isCorrect ? 'Correct' : 'Incorrect'}
                            </span>
                          )}
                          {!quizSubmitted && !userAnswer && (
                            <span className="text-xs font-semibold px-3 py-1 rounded-full flex-shrink-0"
                              style={{ background: C.bg, color: C.textLight }}>
                              Question {i + 1}
                            </span>
                          )}
                        </div>

                        {/* Options in 2x2 grid - matches Image 4 */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {q.options.map(opt => {
                            const selected = userAnswer === opt.label
                            const isOptCorrect = opt.label === q.correct
                            let bg = C.bg
                            let border = C.border
                            let color = C.text

                            if (quizSubmitted && isOptCorrect) {
                              bg = C.successLight; border = C.success; color = C.success
                            }
                            if (quizSubmitted && selected && !isOptCorrect) {
                              bg = C.dangerLight; border = C.danger; color = C.danger
                            }
                            if (!quizSubmitted && selected) {
                              bg = C.accentLight; border = C.accent; color = C.accent
                            }

                            return (
                              <motion.button key={opt.label}
                                whileHover={!quizSubmitted ? { scale: 1.01 } : {}}
                                whileTap={!quizSubmitted ? { scale: 0.99 } : {}}
                                onClick={() => !quizSubmitted && setQuizAnswers(p => ({ ...p, [i]: opt.label }))}
                                className="text-left px-4 py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-between"
                                style={{ background: bg, border: `1.5px solid ${border}`, color }}>
                                <span>
                                  <span className="font-black mr-2">{opt.label}.</span>
                                  {opt.text}
                                </span>
                                {quizSubmitted && isOptCorrect && <span>Correct</span>}
                                {quizSubmitted && selected && !isOptCorrect && <span>Incorrect</span>}
                              </motion.button>
                            )
                          })}
                        </div>

                        {/* Explanation - matches Image 4 info box */}
                        <AnimatePresence>
                          {quizSubmitted && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="mt-4 px-4 py-3 rounded-xl text-sm leading-relaxed flex items-start gap-2"
                              style={{ background: C.accentLight, color: C.accentDark }}>
                              <span className="flex-shrink-0">Info</span>
                              <span>{q.explanation}</span>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    )
                  })}

                  {!quizSubmitted && (
                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                      onClick={() => setQuizSubmitted(true)}
                      disabled={Object.keys(quizAnswers).length < quiz.length}
                      className="px-8 py-3 rounded-full font-bold text-white text-sm disabled:opacity-40"
                      style={{ background: C.accentGrad, boxShadow: `0 4px 16px ${C.accent}30` }}>
                      Submit Quiz 
                    </motion.button>
                  )}

                  {quizSubmitted && (
                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                      onClick={() => { setQuiz(null); setQuizAnswers({}); setQuizSubmitted(false) }}
                      className="px-8 py-3 rounded-full font-semibold text-sm"
                      style={{ background: C.bgCard, color: C.text, border: `1px solid ${C.border}` }}>
                      Try Again
                    </motion.button>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Summary tab ──────────────────────────────── */}
        <AnimatePresence mode="wait">
          {tab === 'summary' && (
            <motion.div key="summary" {...fadeUp}>
              {loading && <SkeletonCard />}

              {!loading && !summary && (
                <EmptyState icon="" title="Ready to Summarise?"
                  subtitle="Paste your notes above and hit generate." />
              )}

              {!loading && summary && (
                <motion.div
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                  className="space-y-4">

                  {/* Title card */}
                  <motion.div variants={cardVariant}
                    className="rounded-2xl p-8"
                    style={{ background: C.accentGrad }}>
                    <p className="text-xs uppercase tracking-widest mb-2 font-semibold"
                      style={{ color: 'rgba(255,255,255,0.6)' }}>Summary</p>
                    <h3 className="text-2xl font-black text-white leading-tight">{summary.title}</h3>
                  </motion.div>

                  {/* Overview */}
                  <motion.div variants={cardVariant}
                    className="rounded-2xl p-6"
                    style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                        style={{ background: C.accentLight }}>
                        <span className="text-xs font-black">OV</span>
                      </div>
                      <p className="font-bold" style={{ color: C.text }}>Overview</p>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: C.text }}>{summary.overview}</p>
                  </motion.div>

                  {/* Key Points + Conclusion side by side - matches Image 5 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Key Points */}
                    <motion.div variants={cardVariant}
                      className="rounded-2xl p-6"
                      style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ background: C.accentLight }}>
                          <span className="text-xs font-black">KP</span>
                        </div>
                        <p className="font-bold" style={{ color: C.text }}>Key Points</p>
                      </div>
                      <div className="space-y-4">
                        {summary.key_points.map((point, i) => (
                          <div key={i} className="flex gap-3 items-start">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5"
                              style={{ background: C.accentLight, color: C.accent }}>
                              {i + 1}
                            </div>
                            <p className="text-sm leading-relaxed" style={{ color: C.text }}>{point}</p>
                          </div>
                        ))}
                      </div>
                    </motion.div>

                    {/* Conclusion */}
                    <motion.div variants={cardVariant}
                      className="rounded-2xl p-6"
                      style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ background: '#FEF3C7' }}>
                          <span className="text-xs font-black">OK</span>
                        </div>
                        <p className="font-bold" style={{ color: C.text }}>Conclusion</p>
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: C.text }}>{summary.conclusion}</p>
                    </motion.div>
                  </div>

                  {/* Ready to Quiz CTA - matches Image 5 bottom button */}
                  <motion.button variants={cardVariant}
                    whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
                    onClick={() => setTab('quizzes')}
                    className="w-full py-4 rounded-2xl font-bold text-white text-base"
                    style={{ background: C.accentGrad, boxShadow: `0 4px 20px ${C.accent}30` }}>
                    Ready to Quiz?
                  </motion.button>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── My Decks tab ─────────────────────────────── */}
        <AnimatePresence mode="wait">
          {tab === 'decks' && (
            <motion.div key="decks" {...fadeUp}>

              {/* Page heading */}
              <div className="mb-6">
                <h2 className="text-3xl font-black mb-1" style={{ color: C.text }}>My Decks</h2>
                <p className="text-sm" style={{ color: C.textMuted }}>Your saved study materials</p>
              </div>

              {/* Stats row - matches Image 6 */}
              {!decksLoading && (
                <motion.div
                  variants={staggerContainer} initial="initial" animate="animate"
                  className="grid grid-cols-3 gap-4 mb-6">
                  {[
                    { label: 'Active Decks', value: savedDecks.length, color: C.accentGrad },
                    { label: 'Total Cards', value: deckStats.totalCards, color: 'linear-gradient(135deg, #38B2AC, #2C7A7B)' },
                    { label: 'Study Streak', value: 'Keep it up!', color: 'linear-gradient(135deg, #C05621, #9C4221)' },
                  ].map((stat, i) => (
                    <motion.div key={stat.label} variants={cardVariant}
                      className="rounded-2xl p-5"
                      style={{ background: stat.color }}>
                      <p className="text-xs font-semibold uppercase tracking-widest mb-2"
                        style={{ color: 'rgba(255,255,255,0.7)' }}>{stat.label}</p>
                      <p className="text-2xl font-black text-white">
                        {stat.label === 'Study Streak'
                          ? (studyStreak.count > 0 ? `${studyStreak.count} day${studyStreak.count === 1 ? '' : 's'}` : 'Start today')
                          : stat.value}
                      </p>
                    </motion.div>
                  ))}
                </motion.div>
              )}

              {decksLoading && (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
                </div>
              )}

              {!decksLoading && savedDecks.length === 0 && (
                <EmptyState icon="" title="No saved decks yet"
                  subtitle="Generate some flashcards and hit Save Deck to store them here." />
              )}

              {!decksLoading && savedDecks.length > 0 && (
                <motion.div
                  variants={staggerContainer} initial="initial" animate="animate"
                  className="space-y-3">
                  {savedDecks.map((deck, idx) => (
                    <motion.div key={deck.id} variants={cardVariant}
                      whileHover={{ scale: 1.005, boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}
                      className="rounded-2xl p-5 flex items-center justify-between"
                      style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
                      <div className="flex items-center gap-4">
                        {/* Colored icon - matches Image 6 subject icons */}
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-black flex-shrink-0"
                          style={{ background: C.accentLight, color: C.accent }}>
                          DECK
                        </div>
                        <div>
                          <p className="font-bold text-sm" style={{ color: C.text }}>{deck.title}</p>
                          <p className="text-xs mt-0.5" style={{ color: C.textLight }}>
                            Created {new Date(deck.created_at).toLocaleDateString('en-NZ', {
                              day: 'numeric', month: 'short', year: 'numeric'
                            })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                          onClick={async () => {
                            const { data } = await supabase
                              .from('flashcards').select('*').eq('deck_id', deck.id)
                            setFlashcards(data)
                            setFlipped({})
                            setCurrentCard(0)
                            setStudyMode('grid')
                            recordStudySession()
                            setTab('flashcards')
                            setToast(`Loaded "${deck.title}"`)
                          }}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold"
                          style={{ background: C.accentGrad, color: 'white' }}>
                          Study
                        </motion.button>
                        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                          onClick={async () => {
                            await supabase.from('decks').delete().eq('id', deck.id)
                            setSavedDecks(prev => prev.filter(d => d.id !== deck.id))
                            setToast('Deck deleted')
                          }}
                          className="p-2 rounded-full text-sm transition-all hover:opacity-80"
                          style={{ background: C.dangerLight, color: C.danger }}>
                          Delete
                        </motion.button>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  )
}
