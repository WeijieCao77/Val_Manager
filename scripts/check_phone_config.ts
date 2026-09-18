import assert from 'node:assert/strict'
import { validatePhoneSecrets } from '../phone-config.js'
assert.throws(() => validatePhoneSecrets({ NODE_ENV: 'production' }), /missing or weak/)
assert.throws(() => validatePhoneSecrets({ RAILWAY_PROJECT_ID: 'test', ANALYTICS_TOKEN: 'short' }), /missing or weak/)
assert.equal(validatePhoneSecrets({ NODE_ENV: 'production', ANALYTICS_TOKEN: 'a'.repeat(32) }).mode, 'legacy-admin')
assert.equal(validatePhoneSecrets({ NODE_ENV: 'production', PHONE_KEY: 'k'.repeat(32), PHONE_SALT: 's'.repeat(32), ANALYTICS_TOKEN: 'a'.repeat(32) }).mode, 'dedicated')
assert.equal(validatePhoneSecrets({}).mode, 'development')
console.log('phone startup validation: missing/weak rejected, legacy identities preserved, dedicated secrets accepted')
