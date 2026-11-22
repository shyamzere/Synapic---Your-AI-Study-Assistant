import { useState } from 'react'
import { supabase } from './supabase'
import { motion, AnimatePresence } from 'framer-motion'
import synapicLogo from './assets/synapicLogo1.png'

const C = {
  bg: '#F7F5F0',
  bgCard: '#FFFFFF',
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
  success: '#38A169',
}

export default function Authentication({ onLogin, onBack, initialMode = 'signin' }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })

  // "Forgot password?": email a reset link. The message is the same whether or
  // not the email has an account, so nobody can use this to find out who has one.
  const handleReset = async () => {
    const address = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setMessage({ text: 'Enter the email you signed up with.', type: 'error' })
      return
    }
    setLoading(true)
    setMessage({ text: '', type: '' })
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: window.location.origin,
      })
      if (error && (error.status === 429 || error.code === 'over_email_send_rate_limit')) {
        setMessage({ text: 'Too many requests. Please wait a few minutes and try again.', type: 'error' })
      } else if (error && !error.status) {
        setMessage({ text: "Couldn't reach the server. Check your connection and try again.", type: 'error' })
      } else {
        setMessage({
          text: 'If an account exists for that email, a reset link is on its way. Open it on this device to choose a new password.',
          type: 'success',
        })
      }
    } catch {
      setMessage({ text: "Couldn't reach the server. Check your connection and try again.", type: 'error' })
    }
    setLoading(false)
  }

  const handleAuth = async () => { // Handles both sign in and sign up, makes sure fields are filled.
    if (mode === 'reset') return handleReset()
    if (!email || !password) {
      setMessage({ text: 'Please fill in all fields.', type: 'error' })
      return
    }
    if (password.length < 6) {
      setMessage({ text: 'Password must be at least 6 characters.', type: 'error' })
      return
    }
    setLoading(true)
    setMessage({ text: '', type: '' })
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (data.session) {
          onLogin()
        } else {
          setMessage({
            text: 'Account created! Check your email to confirm, then sign in.',
            type: 'success'
          })
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        onLogin()
      }
    } catch (err) {
      setMessage({ text: err.message, type: 'error' })
    }
    setLoading(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAuth()
  }

  const switchMode = (newMode) => {
    setMode(newMode)
    setMessage({ text: '', type: '' })
    if (newMode !== 'reset') setEmail('') // keep the typed email when asking for a reset
    setPassword('')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: C.bg }}>

      {/* Background blobs — soft decorative circles like Stitch design */}
      <div className="absolute top-[-100px] right-[-100px] w-96 h-96 rounded-full opacity-20 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #0D9373, transparent)' }} />
      <div className="absolute bottom-[-100px] left-[-100px] w-80 h-80 rounded-full opacity-10 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #0D9373, transparent)' }} />

      {/* Back to home — top left */}
      <button onClick={onBack}
        className="absolute top-6 left-6 transition-opacity hover:opacity-70">
        <img src={synapicLogo} alt="Synapic" className="h-16 w-auto object-contain" />
      </button>

      {/* Auth card */}
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-md rounded-3xl p-8 shadow-xl"
        style={{ background: C.bgCard, border: `1px solid ${C.border}` }}
      >
        {/* Logo + tagline at top of card */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3"
            style={{ background: C.accentLight }}>
            <img src="/plainlogoSynapic.png" alt="" className="h-9 w-9 object-contain" />
          </div>
          <h1 className="text-xl font-black" style={{ color: C.text }}>Synapic</h1>
          <p className="text-xs mt-1" style={{ color: C.textMuted }}>Your premium academic workspace</p>
        </div>

        {mode === 'reset' && (
          <div className="mb-6 text-center">
            <h2 className="text-lg font-black" style={{ color: C.text }}>Reset your password</h2>
            <p className="text-sm mt-1" style={{ color: C.textMuted }}>
              Enter your email and we'll send you a link to choose a new password.
            </p>
          </div>
        )}

        {/* Sign In / Sign Up toggle pill — matches Image 7 exactly */}
        {mode !== 'reset' && <div className="flex p-1 rounded-full mb-6"
          style={{ background: C.bg, border: `1px solid ${C.border}` }}>
          {['signin', 'signup'].map(m => (
            <button key={m}
              onClick={() => switchMode(m)}
              className="flex-1 py-2.5 rounded-full text-sm font-semibold transition-all"
              style={mode === m
                ? { background: C.bgCard, color: C.text, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }
                : { background: 'transparent', color: C.textMuted }
              }>
              {m === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>}

        {/* Form fields */}
        <AnimatePresence mode="wait">
          <motion.div key={mode}
            initial={{ opacity: 0, x: mode === 'signup' ? 12 : -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: mode === 'signup' ? -12 : 12 }}
            transition={{ duration: 0.2 }}
          >
            <div className="space-y-4 mb-5">

              {/* Email */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5"
                  style={{ color: C.textMuted }}>
                  Email Address
                </label>
                <input
                  type="email"
                  placeholder="student@university.edu"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full px-4 py-3 rounded-xl text-sm transition-all focus:outline-none"
                  style={{ background: C.bg, border: `1.5px solid ${C.border}`, color: C.text }}
                  onFocus={e => e.target.style.borderColor = C.accent}
                  onBlur={e => e.target.style.borderColor = C.border}
                />
              </div>

              {/* Password with show/hide toggle — matches Image 7 */}
              {mode !== 'reset' && <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-widest"
                    style={{ color: C.textMuted }}>
                    Password
                  </label>
                  {mode === 'signin' && (
                    <button type="button" onClick={() => switchMode('reset')}
                      className="text-xs hover:underline"
                      style={{ color: C.accent }}>
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Min. 6 characters"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full px-4 py-3 rounded-xl text-sm transition-all focus:outline-none pr-11"
                    style={{ background: C.bg, border: `1.5px solid ${C.border}`, color: C.text }}
                    onFocus={e => e.target.style.borderColor = C.accent}
                    onBlur={e => e.target.style.borderColor = C.border}
                  />
                  {/* Eye toggle */}
                  <label 
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs cursor-pointer"
                    style={{ color: C.textLight }}
                  >
                    <input
                      type="checkbox"
                      checked={showPassword}
                      onChange={e => setShowPassword(e.target.checked)}
                    />
                   Show
                  </label>
                </div>
              </div>}
            </div>

            {/* Error / success message */}
            <AnimatePresence>
              {message.text && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-4 px-4 py-3 rounded-xl text-sm"
                  style={{
                    background: message.type === 'error' ? '#FFF5F5' : C.accentLight,
                    color: message.type === 'error' ? C.danger : C.accent,
                    border: `1px solid ${message.type === 'error' ? C.danger : C.accent}30`
                  }}>
                  {message.text}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit button */}
            <button onClick={handleAuth} disabled={loading}
              className="w-full py-3 rounded-full font-bold text-white text-sm transition-all hover:opacity-90 hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 mb-4"
              style={{ background: C.accentGrad, boxShadow: `0 4px 16px ${C.accent}40` }}>
              {loading ? 'Loading...' : mode === 'reset' ? 'Send reset link' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>

            {/* Bottom toggle link — matches "Don't have an account? Create one for free" */}
            {mode === 'reset' ? (
              <p className="text-center text-sm" style={{ color: C.textMuted }}>
                Remembered it?{' '}
                <button onClick={() => switchMode('signin')} className="font-bold hover:underline" style={{ color: C.accent }}>
                  Back to sign in
                </button>
              </p>
            ) : <p className="text-center text-sm" style={{ color: C.textMuted }}>
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <button onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                className="font-bold hover:underline"
                style={{ color: C.accent }}>
                {mode === 'signin' ? 'Create one for free' : 'Sign in'}
              </button>
            </p>}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* Footer */}
      <p className="text-center text-xs mt-6" style={{ color: C.textLight }}>
        © 2026 Synapic. Premium Scholarly Tools.
      </p>
    </div>
  )
}
