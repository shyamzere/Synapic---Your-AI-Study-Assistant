// Voice typing using the browser's built-in speech recognition
// (Web Speech API: Chrome, Edge, Safari; not Firefox).
//
// Privacy / security notes:
// - Audio never goes to Synapic's server. The browser turns speech into text
//   (Chrome and Edge do this with their maker's online speech service;
//   Safari may do it on the device). We only ever receive plain text.
// - The microphone only starts after the user presses the mic button, the
//   browser asks for permission the first time, and it stops on Stop, when
//   the user goes quiet, or when the component using it goes away.
// - Text is handled exactly like typed text: plain React state (never
//   inserted as HTML), with the same length limits.
import { useCallback, useEffect, useRef, useState } from 'react'

const getRecognitionClass = () =>
  typeof window === 'undefined'
    ? null
    : window.SpeechRecognition || window.webkitSpeechRecognition || null

// Speech recognition only works on https:// (or localhost) pages.
export const isSpeechSupported = () =>
  Boolean(getRecognitionClass()) && typeof window !== 'undefined' && window.isSecureContext

// Join spoken text onto existing text with sensible spacing.
export const joinSpokenText = (current, spoken) => {
  if (!current) return spoken
  return /\s$/.test(current) ? current + spoken : `${current} ${spoken}`
}

const BLOCKED_MESSAGE =
  'Microphone access is blocked. Allow the microphone for this site in your browser settings ' +
  '(on iPhone/iPad, Siri & Dictation must also be on), then try again.'

const ERROR_MESSAGES = {
  'not-allowed': BLOCKED_MESSAGE,
  'service-not-allowed': BLOCKED_MESSAGE,
  'audio-capture': 'No microphone was found. Check that one is connected and try again.',
  network: 'Voice typing needs an internet connection. Check your connection and try again.',
  'no-speech': "Didn't hear anything. Press the mic and try speaking again.",
  'language-not-supported': "Voice typing isn't available for your browser's language.",
}

// Only one microphone session at a time across the whole app.
let stopActiveSession = null

/**
 * useSpeechToText({ onFinalText, onError })
 * Returns { supported, listening, interim, start, stop }.
 * onFinalText(text) is called with each finished phrase; `interim` is the
 * phrase currently being spoken (for a live preview).
 */
export function useSpeechToText({ onFinalText, onError }) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recognitionRef = useRef(null)
  // Always call the latest callbacks without restarting the microphone.
  const callbacksRef = useRef({ onFinalText, onError })
  useEffect(() => {
    callbacksRef.current = { onFinalText, onError }
  })

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    const Recognition = getRecognitionClass()
    if (!Recognition || !window.isSecureContext) {
      callbacksRef.current.onError?.("Voice typing isn't supported in this browser. Try Chrome, Edge or Safari.")
      return
    }
    if (recognitionRef.current) return // already listening

    stopActiveSession?.() // stop the other mic, if one is on

    const recognition = new Recognition()
    recognition.lang = navigator.language || 'en-US'
    // Android Chrome repeats earlier words in continuous mode, so there we
    // take one phrase per press instead.
    recognition.continuous = !/Android/i.test(navigator.userAgent)
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    const stopThisSession = () => recognition.stop()

    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript || ''
        if (result.isFinal) finalText += text
        else interimText += text
      }
      setInterim(interimText.trim())
      // One call per event so phrases can't overwrite each other.
      if (finalText.trim()) callbacksRef.current.onFinalText?.(finalText.trim())
    }

    recognition.onerror = (event) => {
      if (event.error === 'aborted') return // we stopped it on purpose
      callbacksRef.current.onError?.(
        ERROR_MESSAGES[event.error] || 'Voice typing stopped unexpectedly. Please try again.',
      )
    }

    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null
      if (stopActiveSession === stopThisSession) stopActiveSession = null
      setListening(false)
      setInterim('')
    }

    try {
      recognition.start()
      recognitionRef.current = recognition
      stopActiveSession = stopThisSession
      setListening(true)
    } catch {
      callbacksRef.current.onError?.("Couldn't start the microphone. Please try again.")
    }
  }, [])

  // Turn the microphone off if the component using it disappears.
  // (abort() still fires onend, which clears the "one mic at a time" tracker.)
  useEffect(() => () => {
    recognitionRef.current?.abort()
  }, [])

  return { supported: isSpeechSupported(), listening, interim, start, stop }
}
