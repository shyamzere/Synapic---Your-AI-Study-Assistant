// Spaced repetition: show each flashcard again just before you'd forget it.
//
// This is a simplified version of SM-2, the algorithm behind Anki. After you
// see a card's answer you rate how well you remembered it:
//   Again - forgot it        -> see it again in 10 minutes
//   Hard  - barely got it    -> a slightly longer gap
//   Good  - remembered it    -> the gap grows (1 day, 3 days, then x ease)
//   Easy  - knew it instantly -> an even bigger jump
// Each card also has an "ease" (start 2.5). Cards you find hard get a lower
// ease, so their gaps grow more slowly; easy cards grow faster.

export const RATINGS = [
  { id: 'again', label: 'Again', key: '1' },
  { id: 'hard', label: 'Hard', key: '2' },
  { id: 'good', label: 'Good', key: '3' },
  { id: 'easy', label: 'Easy', key: '4' },
]

export const DEFAULT_EASE = 2.5
const MIN_EASE = 1.3
const MAX_EASE = 3.0
const MAX_INTERVAL_DAYS = 365
const AGAIN_DELAY_MINUTES = 10
const DAY_MS = 24 * 60 * 60 * 1000

const toNumber = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback)
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))

// Read a card's saved progress, filling in safe defaults for new cards.
export function cardProgress(card = {}) {
  return {
    ease: clamp(toNumber(card.ease, DEFAULT_EASE), MIN_EASE, MAX_EASE),
    interval: Math.max(0, Math.round(toNumber(card.interval_days, 0))),
    repetitions: Math.max(0, Math.round(toNumber(card.repetitions, 0))),
  }
}

/**
 * Work out a card's next review after it is rated.
 * Returns the database fields to save:
 * { ease, interval_days, repetitions, due_at, last_reviewed_at }.
 */
export function scheduleCard(card, rating, now = new Date()) {
  const { ease, interval, repetitions } = cardProgress(card)
  let nextEase = ease
  let nextInterval
  let nextRepetitions

  if (rating === 'again') {
    nextEase = ease - 0.2
    nextInterval = 0
    nextRepetitions = 0
  } else {
    const good = repetitions === 0 ? 1 : repetitions === 1 ? 3 : Math.round(interval * ease)
    if (rating === 'hard') {
      nextEase = ease - 0.15
      nextInterval = repetitions === 0 ? 1 : Math.max(1, Math.round(interval * 1.2))
      // Hard should never be further away than Good would have been.
      nextInterval = Math.min(nextInterval, Math.max(1, good))
    } else if (rating === 'good') {
      nextInterval = good
    } else if (rating === 'easy') {
      nextEase = ease + 0.15
      nextInterval = repetitions === 0 ? 4 : Math.round(good * 1.3)
    } else {
      throw new Error(`Unknown rating: ${rating}`)
    }
    nextRepetitions = repetitions + 1
  }

  // Each better rating always gives a longer gap than the one before it,
  // and gaps grow on every successful review.
  if (rating === 'good') nextInterval = Math.max(nextInterval, interval + 1)
  if (rating === 'easy') {
    const goodInterval = scheduleCard(card, 'good', now).interval_days
    nextInterval = Math.max(nextInterval, goodInterval + 1)
  }

  nextInterval = clamp(nextInterval, 0, MAX_INTERVAL_DAYS)
  const delayMs = nextInterval === 0 ? AGAIN_DELAY_MINUTES * 60 * 1000 : nextInterval * DAY_MS

  return {
    ease: Math.round(clamp(nextEase, MIN_EASE, MAX_EASE) * 100) / 100,
    interval_days: nextInterval,
    repetitions: nextRepetitions,
    due_at: new Date(now.getTime() + delayMs).toISOString(),
    last_reviewed_at: now.toISOString(),
  }
}

// A card is due if it has never been scheduled or its due time has passed.
export function isDue(card, now = new Date()) {
  if (!card?.due_at) return true
  const due = new Date(card.due_at).getTime()
  return Number.isNaN(due) || due <= now.getTime()
}

// "10 min", "1 day", "45 days", "3 mo", "1 yr", for the rating buttons.
export function formatInterval(days) {
  if (days <= 0) return `${AGAIN_DELAY_MINUTES} min`
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 365) return `${Math.round(days / 30)} mo`
  return '1 yr'
}

// The gap each button would give, e.g. { again: '10 min', good: '3 days' }.
export function previewIntervals(card, now = new Date()) {
  return Object.fromEntries(
    RATINGS.map(r => [r.id, formatInterval(scheduleCard(card, r.id, now).interval_days)]),
  )
}

// "today", "tomorrow", "in 5 days" for when the next review is.
export function describeNextDue(dueAt, now = new Date()) {
  if (!dueAt) return null
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return null
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY_MS)
  if (days <= 0) return 'later today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}
