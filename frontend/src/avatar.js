import { supabase } from './supabase'

// Profile pictures live in a Supabase Storage bucket called "avatars", one
// file per user at "<user id>/avatar.jpg". The bucket's rules (see
// supabase/setup.sql) only let you change files in your own folder.

export const AVATAR_BUCKET = 'avatars'
export const AVATAR_MAX_INPUT_BYTES = 10 * 1024 * 1024 // 10 MB before shrinking
const AVATAR_SIZE = 256 // pixels, square
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const avatarPath = (userId) => `${userId}/avatar.jpg`

// Only trust picture URLs that point at our own avatars bucket, so a
// hand-edited profile can't make the app load images from anywhere else.
const publicPrefix = () => supabase.storage.from(AVATAR_BUCKET).getPublicUrl('').data.publicUrl.replace(/\/?$/, '/')

export function safeAvatarUrl(user) {
  const url = user?.user_metadata?.avatar_url
  if (typeof url !== 'string' || !user?.id) return null
  const prefix = `${publicPrefix()}${user.id}/`
  return url.startsWith(prefix) ? url : null
}

export class AvatarError extends Error {}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new AvatarError("Couldn't open that image. Try a JPG or PNG.")) }
    img.src = url
  })
}

/**
 * Shrink and crop a picture to a 256x256 JPEG in the browser.
 * Redrawing it also strips hidden data such as the photo's GPS location,
 * and means only a plain, small JPEG is ever uploaded.
 */
export async function prepareAvatar(file) {
  if (!file) throw new AvatarError('No picture chosen.')
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new AvatarError('Please choose a JPG, PNG, WebP or GIF image.')
  }
  if (file.size > AVATAR_MAX_INPUT_BYTES) {
    throw new AvatarError('That image is over 10 MB. Please choose a smaller one.')
  }
  const img = await loadImage(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  if (!side) throw new AvatarError("Couldn't open that image. Try a JPG or PNG.")

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#FFFFFF' // transparent PNGs get a white background
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  // Centre crop to a square.
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2
  ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new AvatarError("Couldn't process that image. Try another one.")
  return blob
}

// Upload a prepared picture and return its public URL.
export async function uploadAvatar(userId, blob) {
  const path = avatarPath(userId)
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: 'image/jpeg',
    cacheControl: '3600',
  })
  if (error) throw error
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  // The ?v= part makes browsers fetch the new picture instead of a cached one.
  return `${data.publicUrl}?v=${Date.now()}`
}

export async function removeAvatar(userId) {
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([avatarPath(userId)])
  if (error) throw error
}

// The name shown in the app: chosen display name, else the email's first part.
export function displayNameFor(user) {
  const name = user?.user_metadata?.display_name
  if (typeof name === 'string' && name.trim()) return name.trim()
  return user?.email ? user.email.split('@')[0] : 'Student'
}
