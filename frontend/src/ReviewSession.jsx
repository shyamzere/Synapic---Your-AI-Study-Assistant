import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RATINGS, describeNextDue, previewIntervals, scheduleCard } from './spacedRepetition'

// One spaced-repetition review: show a card, reveal the answer, rate it.
// Cards rated "Again" come back at the end of this session.
//
// Props:
//   theme   - colour tokens (C)
//   title   - what is being reviewed ("Biology" or "All decks")
//   cards   - due cards: { id, question, answer, ease, interval_days, repetitions, due_at }
//   onRate  - (card, rating, update) => void; saves the new schedule
//   onExit  - leave the review
//   otherDueAt - earliest due time of cards NOT in this review (optional)
export default function ReviewSession({ theme: C, title, cards, onRate, onExit, otherDueAt }) {
  const [queue, setQueue] = useState(() => cards.slice())
  const [position, setPosition] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [counts, setCounts] = useState({ again: 0, hard: 0, good: 0, easy: 0 })
  const [nextDue, setNextDue] = useState({}) // card id -> its new due time

  const card = queue[position]
  const finished = !card
  const reviewedCount = counts.hard + counts.good + counts.easy
  const intervals = useMemo(() => (card ? previewIntervals(card) : null), [card])
  const nextDueText = useMemo(() => {
    if (!finished) return null
    const times = [...Object.values(nextDue), otherDueAt].filter(Boolean)
    if (times.length === 0) return null
    const earliest = times.reduce((a, b) => (new Date(a) < new Date(b) ? a : b))
    return describeNextDue(earliest)
  }, [finished, nextDue, otherDueAt])

  const rate = (rating) => {
    if (!card || !revealed) return
    const update = scheduleCard(card, rating)
    onRate(card, rating, update)
    setCounts(prev => ({ ...prev, [rating]: prev[rating] + 1 }))
    setNextDue(prev => ({ ...prev, [card.id]: update.due_at }))
    setQueue(prev => (rating === 'again' ? [...prev, { ...card, ...update }] : prev))
    setPosition(prev => prev + 1)
    setRevealed(false)
  }

  // Keyboard: Space/Enter shows the answer, 1-4 rates it, Esc leaves.
  useEffect(() => {
    const handler = (e) => {
      const target = e.target
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Escape') { onExit(); return }
      if (finished) return
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        setRevealed(true)
        return
      }
      if (revealed) {
        const match = RATINGS.find(r => r.key === e.key)
        if (match) {
          e.preventDefault()
          rate(match.id)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const ratingStyle = {
    again: { background: C.dangerLight, color: C.danger, border: `1px solid ${C.danger}40` },
    hard: { background: C.bg, color: C.text, border: `1px solid ${C.borderStrong}` },
    good: { background: C.accentLight, color: C.accent, border: `1px solid ${C.accent}40` },
    easy: { background: C.accentGrad, color: 'white', border: '1px solid transparent' },
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.textLight }}>
            Review
          </p>
          <h2 className="text-2xl font-black truncate" style={{ color: C.text }}>{title}</h2>
        </div>
        <button type="button" onClick={onExit}
          className="px-4 py-2 rounded-full text-sm font-semibold border transition-all hover:opacity-80"
          style={{ color: C.textMuted, borderColor: C.border, background: C.bgCard }}>
          {finished ? 'Back to My Decks' : 'End review'}
        </button>
      </div>

      {!finished && (
        <>
          <div className="flex items-center justify-between text-xs font-semibold mb-2" style={{ color: C.textMuted }}>
            <span aria-live="polite">Card {position + 1} of {queue.length}</span>
            {counts.again > 0 && <span>{counts.again} to see again</span>}
          </div>
          <div className="h-1.5 rounded-full mb-5 overflow-hidden" style={{ background: C.border }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${(position / queue.length) * 100}%`, background: C.accentGrad }} />
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={`${card.id}-${position}`}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="rounded-3xl p-6 sm:p-8 mb-5"
              style={{ background: C.bgCard, border: `1px solid ${C.border}`, minHeight: '14rem' }}>
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: C.accent }}>
                Question
              </p>
              <p className="text-lg sm:text-xl font-bold leading-relaxed whitespace-pre-wrap break-words" style={{ color: C.text }}>
                {card.question}
              </p>
              {revealed && (
                <div className="mt-6 pt-6" style={{ borderTop: `1px solid ${C.border}` }}>
                  <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: C.accent }}>
                    Answer
                  </p>
                  <p className="text-base sm:text-lg leading-relaxed whitespace-pre-wrap break-words" style={{ color: C.text }}>
                    {card.answer}
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {!revealed ? (
            <button type="button" onClick={() => setRevealed(true)} autoFocus
              className="w-full py-4 rounded-2xl text-base font-bold text-white transition-all hover:opacity-90"
              style={{ background: C.accentGrad }}>
              Show answer
            </button>
          ) : (
            <div>
              <p className="text-sm text-center mb-3" style={{ color: C.textMuted }}>
                How well did you remember it?
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {RATINGS.map(r => (
                  <button key={r.id} type="button" onClick={() => rate(r.id)}
                    aria-label={`${r.label}: see this card again in ${intervals[r.id]}`}
                    className="py-3 px-2 rounded-2xl font-bold transition-all hover:opacity-90"
                    style={ratingStyle[r.id]}>
                    <span className="block text-sm">{r.label}</span>
                    <span className="block text-xs font-semibold opacity-80 mt-0.5">{intervals[r.id]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="hidden md:block text-xs text-center mt-4" style={{ color: C.textLight }}>
            Shortcuts: Space shows the answer, 1-4 rates it, Esc ends the review.
          </p>
        </>
      )}

      {finished && (
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
          className="rounded-3xl p-8 text-center"
          style={{ background: C.bgCard, border: `1px solid ${C.border}` }}>
          <p className="text-4xl mb-3" aria-hidden="true">🎉</p>
          <h3 className="text-2xl font-black mb-2" style={{ color: C.text }}>Review complete</h3>
          <p className="text-sm mb-1" style={{ color: C.textMuted }}>
            You reviewed {reviewedCount} card{reviewedCount === 1 ? '' : 's'}
            {counts.again > 0 ? ` and repeated ${counts.again} you forgot` : ''}.
          </p>
          <p className="text-sm" style={{ color: C.textMuted }}>
            {nextDueText
              ? `Next cards are due ${nextDueText}. Each card comes back right before you're likely to forget it.`
              : "Each card comes back right before you're likely to forget it."}
          </p>
        </motion.div>
      )}
    </div>
  )
}
