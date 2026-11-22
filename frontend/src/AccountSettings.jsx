import { useRef, useState } from 'react'
import { supabase } from './supabase'
import {
  AvatarError, displayNameFor, prepareAvatar, removeAvatar, safeAvatarUrl, uploadAvatar,
} from './avatar'

// Account settings for signed-in users: picture, name, email, password,
// signing out everywhere and deleting the account.
//
// Every change goes through Supabase Auth with the user's own session, so
// people can only ever change their own account.

export const DISPLAY_NAME_MAX = 40
const PASSWORD_MIN = 8
const PASSWORD_MAX = 72 // Supabase ignores anything past 72 characters

// Remove invisible characters (control codes, zero-width and text-direction
// marks) and extra spaces from a name, so it always displays honestly.
const isInvisible = (code) => code < 32 || (code >= 127 && code <= 159)
  || (code >= 0x200B && code <= 0x200F) || (code >= 0x202A && code <= 0x202E)
  || (code >= 0x2066 && code <= 0x2069) || code === 0xFEFF

const cleanDisplayName = (value) => Array.from(value)
  .filter(ch => !isInvisible(ch.codePointAt(0)))
  .join('')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, DISPLAY_NAME_MAX)

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function authErrorMessage(err, fallback) {
  const code = err?.code
  if (code === 'same_password') return 'Your new password must be different from your current one.'
  if (code === 'weak_password') return 'That password is too weak. Try a longer one with a mix of letters, numbers and symbols.'
  if (code === 'email_exists') return 'That email is already used by another account.'
  if (code === 'email_address_invalid') return "That email address doesn't look right."
  if (code === 'over_email_send_rate_limit' || err?.status === 429) return 'Too many attempts. Please wait a few minutes and try again.'
  if (code === 'reauthentication_needed') return 'For security, please sign out, sign back in, and try again.'
  if (err?.name === 'AuthRetryableFetchError' || err instanceof TypeError) {
    return "Couldn't reach the server. Check your connection and try again."
  }
  return fallback
}

// Checks the current password without changing anything.
async function verifyPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (!error) return true
  if (error.code === 'invalid_credentials' || error.status === 400) return false
  throw error
}

function Section({ C, title, description, children, danger = false }) {
  return (
    <section className="rounded-2xl p-6"
      style={{ background: C.bgCard, border: `1px solid ${danger ? `${C.danger}50` : C.border}` }}>
      <h3 className="font-bold text-base" style={{ color: danger ? C.danger : C.text }}>{title}</h3>
      {description && <p className="text-sm mt-1 mb-4" style={{ color: C.textMuted }}>{description}</p>}
      {children}
    </section>
  )
}

function Field({ C, label, ...inputProps }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: C.textMuted }}>
        {label}
      </span>
      <input {...inputProps}
        className="w-full px-4 py-2.5 rounded-xl text-base sm:text-sm outline-none transition-all"
        style={{ background: C.bg, color: C.text, border: `1.5px solid ${C.border}` }} />
    </label>
  )
}

function PrimaryButton({ C, children, busy, ...props }) {
  return (
    <button type="submit" {...props} disabled={busy || props.disabled}
      className="px-5 py-2.5 rounded-full text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ background: C.accentGrad }}>
      {busy ? 'Saving...' : children}
    </button>
  )
}

export function Avatar({ C, user, size = 40 }) {
  const url = safeAvatarUrl(user)
  const name = displayNameFor(user)
  const [broken, setBroken] = useState(null)
  if (url && broken !== url) {
    return (
      <img src={url} alt="" width={size} height={size} onError={() => setBroken(url)}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size, border: `1px solid ${C.border}` }}
        referrerPolicy="no-referrer" />
    )
  }
  return (
    <span aria-hidden="true"
      className="rounded-full flex items-center justify-center font-black flex-shrink-0 select-none"
      style={{ width: size, height: size, background: C.accentLight, color: C.accent, fontSize: size * 0.42 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

export default function AccountSettings({ theme: C, user, onToast, recoveryMode, onRecoveryDone, onAccountDeleted }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(null) // which action is running
  const [name, setName] = useState(() => user?.user_metadata?.display_name || '')
  const [newEmail, setNewEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [showDelete, setShowDelete] = useState(false)

  const run = async (key, fn) => {
    if (busy) return
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  // ── Picture ──────────────────────────────────────────────
  const handlePicture = (file) => run('picture', async () => {
    try {
      const blob = await prepareAvatar(file)
      const url = await uploadAvatar(user.id, blob)
      const { error } = await supabase.auth.updateUser({ data: { avatar_url: url } })
      if (error) throw error
      onToast('Profile picture updated')
    } catch (err) {
      if (err instanceof AvatarError) onToast(err.message)
      else if (/bucket not found/i.test(err?.message || '')) onToast("Profile pictures aren't switched on yet. Please try again later.")
      else onToast(authErrorMessage(err, "Couldn't upload your picture. Please try again."))
    }
  })

  const handleRemovePicture = () => run('picture', async () => {
    try {
      await removeAvatar(user.id).catch(() => {}) // the file may already be gone
      const { error } = await supabase.auth.updateUser({ data: { avatar_url: null } })
      if (error) throw error
      onToast('Profile picture removed')
    } catch (err) {
      onToast(authErrorMessage(err, "Couldn't remove your picture. Please try again."))
    }
  })

  // ── Name ─────────────────────────────────────────────────
  const savedName = user?.user_metadata?.display_name || ''
  const handleName = (e) => {
    e.preventDefault()
    const cleaned = cleanDisplayName(name)
    run('name', async () => {
      try {
        const { error } = await supabase.auth.updateUser({ data: { display_name: cleaned || null } })
        if (error) throw error
        setName(cleaned)
        onToast(cleaned ? `You'll now show as "${cleaned}"` : 'Display name cleared')
      } catch (err) {
        onToast(authErrorMessage(err, "Couldn't save your name. Please try again."))
      }
    })
  }

  // ── Email ────────────────────────────────────────────────
  const handleEmail = (e) => {
    e.preventDefault()
    const email = newEmail.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(email)) { onToast("That email address doesn't look right."); return }
    if (email === (user.email || '').toLowerCase()) { onToast("That's already your email."); return }
    run('email', async () => {
      try {
        const { error } = await supabase.auth.updateUser(
          { email },
          { emailRedirectTo: window.location.origin },
        )
        if (error) throw error
        setNewEmail('')
        onToast(`Check ${email} (and your current inbox) for a confirmation link. Your email changes once you click it.`)
      } catch (err) {
        onToast(authErrorMessage(err, "Couldn't change your email. Please try again."))
      }
    })
  }

  // ── Password ─────────────────────────────────────────────
  const handlePassword = (e) => {
    e.preventDefault()
    if (newPassword.length < PASSWORD_MIN) { onToast(`Your new password needs at least ${PASSWORD_MIN} characters.`); return }
    if (newPassword.length > PASSWORD_MAX) { onToast(`Please keep your password under ${PASSWORD_MAX} characters.`); return }
    if (newPassword !== confirmPassword) { onToast("The two new passwords don't match."); return }
    if (!recoveryMode && !currentPassword) { onToast('Enter your current password.'); return }
    run('password', async () => {
      try {
        if (!recoveryMode) {
          const ok = await verifyPassword(user.email, currentPassword)
          if (!ok) { onToast('Your current password is incorrect.'); return }
        }
        const { error } = await supabase.auth.updateUser({ password: newPassword })
        if (error) throw error
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        onToast('Password changed')
        if (recoveryMode) onRecoveryDone()
      } catch (err) {
        onToast(authErrorMessage(err, "Couldn't change your password. Please try again."))
      }
    })
  }

  // ── Sessions ─────────────────────────────────────────────
  const handleSignOutEverywhere = () => run('signout', async () => {
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) onToast(authErrorMessage(error, "Couldn't sign out everywhere. Please try again."))
  })

  // ── Delete account ───────────────────────────────────────
  const handleDelete = (e) => {
    e.preventDefault()
    if (deleteConfirm.trim() !== 'DELETE') { onToast('Type DELETE in capitals to confirm.'); return }
    if (!deletePassword) { onToast('Enter your password to confirm.'); return }
    run('delete', async () => {
      try {
        const ok = await verifyPassword(user.email, deletePassword)
        if (!ok) { onToast('That password is incorrect.'); return }
        await removeAvatar(user.id).catch(() => {})
        const { error } = await supabase.rpc('delete_my_account')
        if (error) {
          if (error.code === 'PGRST202') { onToast("Account deletion isn't switched on yet. Please try again later."); return }
          throw error
        }
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        onAccountDeleted()
      } catch (err) {
        onToast(authErrorMessage(err, "Couldn't delete your account. Please try again."))
      }
    })
  }

  const hasPicture = Boolean(safeAvatarUrl(user))

  return (
    <div className="space-y-4">
      {recoveryMode && (
        <div role="alert" className="rounded-2xl p-4 text-sm font-semibold"
          style={{ background: C.accentLight, color: C.accent, border: `1px solid ${C.accent}40` }}>
          You opened a password reset link. Choose a new password below.
        </div>
      )}

      <Section C={C} title="Profile" description="How you appear in Synapic.">
        <div className="flex flex-wrap items-center gap-4 mb-5">
          <Avatar C={C} user={user} size={64} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}
              className="px-4 py-2 rounded-full text-sm font-bold transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: C.accentLight, color: C.accent, border: `1px solid ${C.accent}30` }}>
              {busy === 'picture' ? 'Uploading...' : hasPicture ? 'Change picture' : 'Upload picture'}
            </button>
            {hasPicture && (
              <button type="button" onClick={handleRemovePicture} disabled={Boolean(busy)}
                className="px-4 py-2 rounded-full text-sm font-semibold border transition-all hover:opacity-80 disabled:opacity-50"
                style={{ color: C.textMuted, borderColor: C.border, background: C.bg }}>
                Remove
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden" aria-label="Choose a profile picture"
              onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) handlePicture(file) }} />
          </div>
          <p className="w-full text-xs" style={{ color: C.textLight }}>
            JPG, PNG, WebP or GIF, up to 10 MB. It's cropped to a square and shrunk before uploading.
          </p>
        </div>

        <form onSubmit={handleName} className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <Field C={C} label="Display name" value={name} maxLength={DISPLAY_NAME_MAX}
              placeholder={displayNameFor({ email: user.email })}
              autoComplete="nickname" onChange={e => setName(e.target.value)} />
          </div>
          <PrimaryButton C={C} busy={busy === 'name'}
            disabled={Boolean(busy) || cleanDisplayName(name) === savedName}>
            Save name
          </PrimaryButton>
        </form>
      </Section>

      <Section C={C} title="Email"
        description={<>You sign in with <strong style={{ color: C.text }}>{user.email}</strong>.</>}>
        <form onSubmit={handleEmail} noValidate className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <Field C={C} label="New email" type="email" value={newEmail} autoComplete="email"
              placeholder="new@example.com" onChange={e => setNewEmail(e.target.value)} />
          </div>
          <PrimaryButton C={C} busy={busy === 'email'} disabled={Boolean(busy) || !newEmail.trim()}>
            Change email
          </PrimaryButton>
        </form>
      </Section>

      <Section C={C} title="Password"
        description={recoveryMode ? 'Pick a new password.' : 'Enter your current password, then your new one.'}>
        <form onSubmit={handlePassword} className="space-y-3">
          {/* Hidden username field helps password managers save the right account. */}
          <input type="email" name="username" autoComplete="username" value={user.email || ''} readOnly hidden />
          {!recoveryMode && (
            <Field C={C} label="Current password" type="password" value={currentPassword}
              autoComplete="current-password" onChange={e => setCurrentPassword(e.target.value)} />
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field C={C} label="New password" type="password" value={newPassword} maxLength={PASSWORD_MAX}
              autoComplete="new-password" placeholder={`At least ${PASSWORD_MIN} characters`}
              onChange={e => setNewPassword(e.target.value)} />
            <Field C={C} label="Confirm new password" type="password" value={confirmPassword} maxLength={PASSWORD_MAX}
              autoComplete="new-password" onChange={e => setConfirmPassword(e.target.value)} />
          </div>
          <PrimaryButton C={C} busy={busy === 'password'} disabled={Boolean(busy) || !newPassword}>
            Change password
          </PrimaryButton>
        </form>
      </Section>

      <Section C={C} title="Signed-in devices"
        description="Lost a device or used a shared computer? This signs you out everywhere, including here.">
        <button type="button" onClick={handleSignOutEverywhere} disabled={Boolean(busy)}
          className="px-5 py-2.5 rounded-full text-sm font-semibold border transition-all hover:opacity-80 disabled:opacity-50"
          style={{ color: C.text, borderColor: C.borderStrong, background: C.bg }}>
          {busy === 'signout' ? 'Signing out...' : 'Sign out of all devices'}
        </button>
      </Section>

      <Section C={C} danger title="Delete account"
        description="Permanently deletes your account, saved decks, flashcards and profile picture. This can't be undone.">
        {!showDelete ? (
          <button type="button" onClick={() => setShowDelete(true)}
            className="px-5 py-2.5 rounded-full text-sm font-bold transition-all hover:opacity-90"
            style={{ background: C.dangerLight, color: C.danger, border: `1px solid ${C.danger}40` }}>
            Delete my account...
          </button>
        ) : (
          <form onSubmit={handleDelete} className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field C={C} label="Your password" type="password" value={deletePassword}
                autoComplete="current-password" onChange={e => setDeletePassword(e.target.value)} />
              <Field C={C} label='Type "DELETE" to confirm' value={deleteConfirm}
                autoComplete="off" onChange={e => setDeleteConfirm(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={Boolean(busy) || deleteConfirm.trim() !== 'DELETE' || !deletePassword}
                className="px-5 py-2.5 rounded-full text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: C.danger }}>
                {busy === 'delete' ? 'Deleting...' : 'Permanently delete my account'}
              </button>
              <button type="button" onClick={() => { setShowDelete(false); setDeletePassword(''); setDeleteConfirm('') }}
                className="px-5 py-2.5 rounded-full text-sm font-semibold border transition-all hover:opacity-80"
                style={{ color: C.textMuted, borderColor: C.border, background: C.bg }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </Section>
    </div>
  )
}
