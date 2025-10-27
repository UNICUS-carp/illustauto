/**
 * Improved Authentication Service with Comprehensive Error Handling
 *
 * This service implements WebAuthn authentication with:
 * - Detailed error logging and tracking
 * - Configurable timeouts
 * - Retry mechanisms
 * - Better user experience through clear error messages
 */

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const ErrorLogger = require('../utils/errorLogger');

class AuthService {
  constructor(config = {}) {
    this.rpName = config.rpName || 'IllustAuto';
    this.rpID = config.rpID || 'unicus.top';
    this.origin = config.origin || `https://${this.rpID}`;

    // Timeout configurations (in milliseconds)
    this.timeouts = {
      registration: config.registrationTimeout || 120000, // 120 seconds (2 minutes)
      authentication: config.authenticationTimeout || 90000, // 90 seconds (1.5 minutes)
      challengeExpiry: config.challengeExpiry || 300000, // 5 minutes
    };

    // Retry configurations
    this.retryConfig = {
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000, // 1 second
    };

    // Initialize error logger
    this.errorLogger = new ErrorLogger({
      logDir: config.logDir,
      enableConsole: config.enableConsoleLog !== false,
      enableFile: config.enableFileLog !== false,
    });

    // Challenge storage (in production, use Redis or similar)
    this.challenges = new Map();

    console.log('[authService] Initialized with config:', {
      rpName: this.rpName,
      rpID: this.rpID,
      origin: this.origin,
      timeouts: this.timeouts,
    });
  }

  /**
   * Generate registration options with improved error handling
   */
  async generateRegistrationOptions(email, userId) {
    const operation = 'generateRegistrationOptions';
    const startTime = Date.now();

    try {
      console.log(`[authService] ${operation} for:`, email);

      // Validate input
      if (!email || !this.isValidEmail(email)) {
        throw new Error('Invalid email address');
      }

      const options = await generateRegistrationOptions({
        rpName: this.rpName,
        rpID: this.rpID,
        userName: email,
        userDisplayName: email,
        timeout: this.timeouts.registration,
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
          authenticatorAttachment: 'platform',
        },
        excludeCredentials: [], // TODO: Exclude existing credentials
      });

      // Store challenge with expiry
      this.storeChallenge(userId, options.challenge, 'registration');

      const duration = Date.now() - startTime;
      this.errorLogger.logSuccess({
        operation,
        userId,
        email,
        duration,
        context: { timeout: this.timeouts.registration },
      });

      console.log(`[authService] Registration options generated for user ${userId} (${duration}ms)`);

      return {
        success: true,
        options,
        metadata: {
          timeout: this.timeouts.registration,
          expiresAt: Date.now() + this.timeouts.challengeExpiry,
        },
      };
    } catch (error) {
      const sessionId = this.errorLogger.logAuthError({
        error,
        operation,
        userId,
        email,
        context: {
          timeout: this.timeouts.registration,
        },
      });

      console.error(`[authService] ${operation} failed:`, error.message);

      return {
        success: false,
        error: {
          message: this.getUserFriendlyErrorMessage(error, 'registration'),
          code: error.code || 'REGISTRATION_OPTIONS_FAILED',
          sessionId,
        },
      };
    }
  }

  /**
   * Verify registration response with comprehensive error handling
   */
  async verifyRegistration(userId, response, userAgent = null) {
    const operation = 'verifyRegistration';
    const startTime = Date.now();

    try {
      console.log(`[authService] ${operation} for user:`, userId);

      // Retrieve and validate challenge
      const expectedChallenge = this.getChallenge(userId, 'registration');
      if (!expectedChallenge) {
        throw new Error('Challenge not found or expired. Please try registering again.');
      }

      // Verify with detailed logging
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response,
          expectedChallenge,
          expectedOrigin: this.origin,
          expectedRPID: this.rpID,
        });
      } catch (verifyError) {
        // Log WebAuthn-specific error
        const sessionId = this.errorLogger.logWebAuthnError({
          error: verifyError,
          phase: 'registration',
          userId,
          email: null,
          expectedChallenge,
          receivedData: response,
          context: {
            origin: this.origin,
            rpId: this.rpID,
            timeout: this.timeouts.registration,
            userAgent,
          },
        });

        throw new Error(`Verification failed: ${verifyError.message} (Session: ${sessionId})`);
      }

      if (!verification.verified) {
        throw new Error('Registration verification failed');
      }

      // Clear challenge after successful verification
      this.clearChallenge(userId, 'registration');

      const duration = Date.now() - startTime;
      this.errorLogger.logSuccess({
        operation,
        userId,
        email: null,
        duration,
        context: {
          credentialId: verification.registrationInfo.credentialID.toString('base64'),
          userVerified: verification.registrationInfo.userVerified,
          deviceType: verification.registrationInfo.credentialDeviceType,
        },
      });

      console.log(`[authService] Registration verified for user ${userId} (${duration}ms)`);

      return {
        success: true,
        verification,
        duration,
      };
    } catch (error) {
      const sessionId = this.errorLogger.logAuthError({
        error,
        operation,
        userId,
        email: null,
        context: {
          hasChallenge: this.hasChallenge(userId, 'registration'),
          userAgent,
        },
      });

      // Check if this is a timeout error
      const duration = Date.now() - startTime;
      if (duration > this.timeouts.registration) {
        this.errorLogger.logTimeoutError({
          operation,
          userId,
          email: null,
          timeout: this.timeouts.registration,
          startTime,
          context: { userAgent },
        });
      }

      console.error(`[authService] ${operation} failed:`, error.message);

      return {
        success: false,
        error: {
          message: this.getUserFriendlyErrorMessage(error, 'registration'),
          code: error.code || 'REGISTRATION_VERIFICATION_FAILED',
          sessionId,
          canRetry: this.canRetryError(error),
        },
      };
    }
  }

  /**
   * Generate authentication options with improved error handling
   */
  async generateAuthenticationOptions(email, userId, credentials = []) {
    const operation = 'generateAuthenticationOptions';
    const startTime = Date.now();

    try {
      console.log(`[authService] ${operation} for:`, email);

      // Validate input
      if (!email || !this.isValidEmail(email)) {
        throw new Error('Invalid email address');
      }

      if (!credentials || credentials.length === 0) {
        throw new Error('No credentials found for this user. Please register first.');
      }

      const options = await generateAuthenticationOptions({
        rpID: this.rpID,
        timeout: this.timeouts.authentication,
        allowCredentials: credentials.map(cred => ({
          id: cred.credentialID,
          type: 'public-key',
          transports: cred.transports || ['internal'],
        })),
        userVerification: 'preferred',
      });

      // Store challenge with expiry
      this.storeChallenge(userId, options.challenge, 'authentication');

      const duration = Date.now() - startTime;
      this.errorLogger.logSuccess({
        operation,
        userId,
        email,
        duration,
        context: {
          timeout: this.timeouts.authentication,
          credentialCount: credentials.length,
        },
      });

      console.log(`[authService] Authentication options generated for user ${userId} (${duration}ms)`);

      return {
        success: true,
        options,
        metadata: {
          timeout: this.timeouts.authentication,
          expiresAt: Date.now() + this.timeouts.challengeExpiry,
          credentialCount: credentials.length,
        },
      };
    } catch (error) {
      const sessionId = this.errorLogger.logAuthError({
        error,
        operation,
        userId,
        email,
        context: {
          timeout: this.timeouts.authentication,
          credentialCount: credentials.length,
        },
      });

      console.error(`[authService] ${operation} failed:`, error.message);

      return {
        success: false,
        error: {
          message: this.getUserFriendlyErrorMessage(error, 'authentication'),
          code: error.code || 'AUTHENTICATION_OPTIONS_FAILED',
          sessionId,
        },
      };
    }
  }

  /**
   * Verify authentication response with comprehensive error handling
   */
  async verifyAuthentication(userId, email, response, credential, userAgent = null) {
    const operation = 'verifyAuthentication';
    const startTime = Date.now();

    try {
      console.log(`[authService] ${operation} for user:`, userId);

      // Retrieve and validate challenge
      const expectedChallenge = this.getChallenge(userId, 'authentication');
      if (!expectedChallenge) {
        throw new Error('Challenge not found or expired. Please try authenticating again.');
      }

      // Verify with detailed logging
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge,
          expectedOrigin: this.origin,
          expectedRPID: this.rpID,
          authenticator: {
            credentialID: credential.credentialID,
            credentialPublicKey: credential.credentialPublicKey,
            counter: credential.counter,
          },
        });
      } catch (verifyError) {
        // Log WebAuthn-specific error
        const sessionId = this.errorLogger.logWebAuthnError({
          error: verifyError,
          phase: 'authentication',
          userId,
          email,
          expectedChallenge,
          receivedData: response,
          context: {
            origin: this.origin,
            rpId: this.rpID,
            timeout: this.timeouts.authentication,
            userAgent,
            credentialId: credential.credentialID.toString('base64'),
          },
        });

        throw new Error(`Verification failed: ${verifyError.message} (Session: ${sessionId})`);
      }

      if (!verification.verified) {
        throw new Error('Authentication verification failed');
      }

      // Clear challenge after successful verification
      this.clearChallenge(userId, 'authentication');

      const duration = Date.now() - startTime;
      this.errorLogger.logSuccess({
        operation,
        userId,
        email,
        duration,
        context: {
          credentialId: credential.credentialID.toString('base64'),
          newCounter: verification.authenticationInfo.newCounter,
          userVerified: verification.authenticationInfo.userVerified,
        },
      });

      console.log(`[authService] Authentication verified for user ${userId} (${duration}ms)`);

      return {
        success: true,
        verification,
        duration,
      };
    } catch (error) {
      const sessionId = this.errorLogger.logAuthError({
        error,
        operation,
        userId,
        email,
        context: {
          hasChallenge: this.hasChallenge(userId, 'authentication'),
          userAgent,
        },
      });

      // Check if this is a timeout error
      const duration = Date.now() - startTime;
      if (duration > this.timeouts.authentication) {
        this.errorLogger.logTimeoutError({
          operation,
          userId,
          email,
          timeout: this.timeouts.authentication,
          startTime,
          context: { userAgent },
        });
      }

      console.error(`[authService] ${operation} failed:`, error.message);

      return {
        success: false,
        error: {
          message: this.getUserFriendlyErrorMessage(error, 'authentication'),
          code: error.code || 'AUTHENTICATION_VERIFICATION_FAILED',
          sessionId,
          canRetry: this.canRetryError(error),
        },
      };
    }
  }

  /**
   * Store challenge with type and expiry
   */
  storeChallenge(userId, challenge, type) {
    const key = `${userId}_${type}`;
    this.challenges.set(key, {
      challenge,
      type,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.timeouts.challengeExpiry,
    });

    // Clean up expired challenges periodically
    this.cleanupExpiredChallenges();
  }

  /**
   * Get challenge and validate expiry
   */
  getChallenge(userId, type) {
    const key = `${userId}_${type}`;
    const data = this.challenges.get(key);

    if (!data) {
      console.warn(`[authService] Challenge not found: ${key}`);
      return null;
    }

    if (Date.now() > data.expiresAt) {
      console.warn(`[authService] Challenge expired: ${key}`);
      this.challenges.delete(key);
      return null;
    }

    return data.challenge;
  }

  /**
   * Check if challenge exists
   */
  hasChallenge(userId, type) {
    const key = `${userId}_${type}`;
    return this.challenges.has(key);
  }

  /**
   * Clear challenge after use
   */
  clearChallenge(userId, type) {
    const key = `${userId}_${type}`;
    this.challenges.delete(key);
  }

  /**
   * Clean up expired challenges
   */
  cleanupExpiredChallenges() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, data] of this.challenges.entries()) {
      if (now > data.expiresAt) {
        this.challenges.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[authService] Cleaned up ${cleaned} expired challenges`);
    }
  }

  /**
   * Validate email format
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Determine if error is retryable
   */
  canRetryError(error) {
    const retryableErrors = [
      'timeout',
      'network',
      'Challenge not found',
      'expired',
    ];

    const message = error.message.toLowerCase();
    return retryableErrors.some(keyword => message.includes(keyword));
  }

  /**
   * Convert technical errors to user-friendly messages
   */
  getUserFriendlyErrorMessage(error, operation) {
    const message = error.message.toLowerCase();

    if (message.includes('timeout')) {
      return operation === 'registration'
        ? '登録のタイムアウトが発生しました。生体認証デバイスの操作に十分な時間を確保してください。もう一度お試しください。'
        : '認証のタイムアウトが発生しました。生体認証デバイスの操作に十分な時間を確保してください。もう一度お試しください。';
    }

    if (message.includes('not allowed') || message.includes('notallowederror')) {
      return '認証がキャンセルされたか、ブラウザによってブロックされました。HTTPSで接続していることを確認し、もう一度お試しください。';
    }

    if (message.includes('challenge')) {
      return 'セッションの有効期限が切れました。ページを再読み込みして、もう一度お試しください。';
    }

    if (message.includes('origin')) {
      return 'オリジンの検証に失敗しました。正しいURLからアクセスしていることを確認してください。';
    }

    if (message.includes('credential') && message.includes('not found')) {
      return '認証情報が見つかりませんでした。まず登録を完了してください。';
    }

    if (message.includes('invalid email')) {
      return '無効なメールアドレスです。正しいメールアドレスを入力してください。';
    }

    // Default message
    return `認証エラーが発生しました: ${error.message}。問題が解決しない場合は、サポートにお問い合わせください。`;
  }

  /**
   * Get error statistics for monitoring
   */
  async getErrorStatistics(hours = 24) {
    const [authErrors, webauthnErrors, timeoutErrors] = await Promise.all([
      this.errorLogger.getErrorStatistics('auth-error', hours),
      this.errorLogger.getErrorStatistics('webauthn-error', hours),
      this.errorLogger.getErrorStatistics('timeout-error', hours),
    ]);

    return {
      period: `Last ${hours} hours`,
      authentication: authErrors,
      webauthn: webauthnErrors,
      timeout: timeoutErrors,
    };
  }
}

module.exports = AuthService;
