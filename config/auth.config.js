/**
 * Authentication Configuration
 *
 * Centralized configuration for authentication timeouts, retry logic, and error handling.
 * This allows easy adjustment without code changes.
 */

module.exports = {
  // WebAuthn Configuration
  webauthn: {
    rpName: process.env.RP_NAME || 'IllustAuto',
    rpID: process.env.RP_ID || 'unicus.top',
    origin: process.env.ORIGIN || `https://${process.env.RP_ID || 'unicus.top'}`,
  },

  // Timeout Configuration (in milliseconds)
  timeouts: {
    // Registration timeout - time allowed for user to complete biometric registration
    // Recommendation: 120-180 seconds to allow users time to understand and use their device
    registration: parseInt(process.env.REGISTRATION_TIMEOUT) || 120000, // 2 minutes

    // Authentication timeout - time allowed for user to complete biometric authentication
    // Recommendation: 90-120 seconds, slightly shorter than registration
    authentication: parseInt(process.env.AUTHENTICATION_TIMEOUT) || 90000, // 1.5 minutes

    // Challenge expiry - how long a challenge remains valid
    // Recommendation: 5-10 minutes to allow for page refresh and retry
    challengeExpiry: parseInt(process.env.CHALLENGE_EXPIRY) || 300000, // 5 minutes

    // Session timeout - how long a session remains active after authentication
    session: parseInt(process.env.SESSION_TIMEOUT) || 3600000, // 1 hour
  },

  // Retry Configuration
  retry: {
    // Maximum number of retry attempts for failed operations
    maxRetries: parseInt(process.env.MAX_RETRIES) || 3,

    // Delay between retry attempts (in milliseconds)
    retryDelay: parseInt(process.env.RETRY_DELAY) || 1000, // 1 second

    // Use exponential backoff for retries
    exponentialBackoff: process.env.EXPONENTIAL_BACKOFF !== 'false',

    // Maximum retry delay when using exponential backoff
    maxRetryDelay: parseInt(process.env.MAX_RETRY_DELAY) || 10000, // 10 seconds
  },

  // Error Logging Configuration
  logging: {
    // Directory for log files
    logDir: process.env.LOG_DIR || './logs',

    // Enable console logging
    enableConsole: process.env.ENABLE_CONSOLE_LOG !== 'false',

    // Enable file logging
    enableFile: process.env.ENABLE_FILE_LOG !== 'false',

    // Maximum log file size before rotation (in bytes)
    maxLogSize: parseInt(process.env.MAX_LOG_SIZE) || 10485760, // 10MB

    // Maximum number of rotated log files to keep
    maxLogFiles: parseInt(process.env.MAX_LOG_FILES) || 10,

    // Log level (debug, info, warn, error)
    level: process.env.LOG_LEVEL || 'info',
  },

  // Security Configuration
  security: {
    // Allowed origins for CORS
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ['https://unicus.top'],

    // Maximum login attempts before temporary lockout
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5,

    // Lockout duration after max attempts (in milliseconds)
    lockoutDuration: parseInt(process.env.LOCKOUT_DURATION) || 900000, // 15 minutes

    // Require user verification (biometric/PIN)
    requireUserVerification: process.env.REQUIRE_USER_VERIFICATION !== 'false',
  },

  // User Experience Configuration
  ux: {
    // Show detailed error messages to users (disable in production for security)
    showDetailedErrors: process.env.SHOW_DETAILED_ERRORS === 'true',

    // Provide retry suggestions to users
    showRetrySuggestions: process.env.SHOW_RETRY_SUGGESTIONS !== 'false',

    // Show timeout countdown to users
    showTimeoutCountdown: process.env.SHOW_TIMEOUT_COUNTDOWN !== 'false',

    // Allow users to request timeout extension
    allowTimeoutExtension: process.env.ALLOW_TIMEOUT_EXTENSION === 'true',
  },

  // Monitoring Configuration
  monitoring: {
    // Enable error statistics collection
    enableStats: process.env.ENABLE_STATS !== 'false',

    // Statistics collection period (in hours)
    statsPeriod: parseInt(process.env.STATS_PERIOD) || 24,

    // Alert threshold for error rate (errors per hour)
    errorRateThreshold: parseInt(process.env.ERROR_RATE_THRESHOLD) || 10,

    // Enable webhook notifications for critical errors
    enableWebhookNotifications: process.env.ENABLE_WEBHOOK_NOTIFICATIONS === 'true',

    // Webhook URL for notifications
    webhookUrl: process.env.WEBHOOK_URL || null,
  },
};
