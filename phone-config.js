/** Validate startup without silently rotating the keys protecting existing identities. */
export function validatePhoneSecrets(env = process.env) {
  const production = env.NODE_ENV === 'production' || !!env.RAILWAY_PROJECT_ID
  const legacy = env.ANALYTICS_TOKEN || ''
  const key = env.PHONE_KEY || legacy
  const salt = env.PHONE_SALT || legacy
  if (production && (!key || !salt || key.length < 24 || salt.length < 24
    || key === 'valmanager-phone-key' || salt === 'valmanager-phone')) {
    throw new Error('Production phone secrets missing or weak; preserve existing secrets during configuration, never generate replacements at boot')
  }
  if (!production && (!key || !salt)) return { mode: 'development' }
  return { mode: !env.PHONE_KEY || !env.PHONE_SALT || key === legacy || salt === legacy ? 'legacy-admin' : 'dedicated' }
}
