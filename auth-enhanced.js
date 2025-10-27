/**
 * Enhanced Passkey Authenticator with Comprehensive Error Logging
 *
 * 既存の認証機能に詳細なエラーログと監視機能を追加
 * すべての既存機能を維持しながら、エラー追跡を強化
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import ErrorLogger from './utils/errorLogger-enhanced.js';

class PasskeyAuthenticator {
  constructor(database, config = {}) {
    this.db = database;
    this.rpName = 'IllustAuto';
    this.rpID = process.env.NODE_ENV === 'production'
      ? 'unicus.top'
      : 'localhost';
    this.origin = process.env.NODE_ENV === 'production'
      ? 'https://unicus.top'
      : 'http://localhost:3000';

    // タイムアウト設定（環境変数から取得、デフォルト値あり）
    this.timeouts = {
      registration: parseInt(process.env.REGISTRATION_TIMEOUT) || 120000, // 2分
      authentication: parseInt(process.env.AUTHENTICATION_TIMEOUT) || 90000, // 1.5分
      challengeExpiry: parseInt(process.env.CHALLENGE_EXPIRY) || 300000, // 5分
    };

    // エラーロガーの初期化
    this.errorLogger = new ErrorLogger({
      logDir: config.logDir || process.env.LOG_DIR,
      enableConsole: config.enableConsoleLog !== false,
      enableFile: config.enableFileLog !== false,
    });

    console.log(`[auth] Initialized for ${this.rpID} (${process.env.NODE_ENV || 'development'})`);
    console.log(`[auth] Timeouts: registration=${this.timeouts.registration}ms, authentication=${this.timeouts.authentication}ms`);
  }

  // ========================================
  // 登録フロー（エラーログ統合版）
  // ========================================

  async generateRegistrationOptions(userEmail, userName = null) {
    const operation = 'generateRegistrationOptions';
    const startTime = Date.now();

    try {
      console.log(`[auth] Generating registration options for: ${userEmail}`);

      // メールアドレスのバリデーション
      if (!userEmail || !this.isValidEmail(userEmail)) {
        throw new Error('Invalid email address');
      }

      // 既存ユーザーをチェック
      let user = await this.db.getUserByEmail(userEmail);
      if (!user) {
        const userId = await this.db.createUser(userEmail, userName);
        user = await this.db.getUserById(userId);
        console.log(`[auth] Created new user: ${userId}`);
      }

      // 既存の認証情報を取得
      const existingCredentials = await this.db.getUserCredentials(user.id);
      const excludeCredentials = existingCredentials.map(cred => ({
        id: cred.credential_id,
        type: 'public-key',
        transports: cred.transports
      }));

      const options = await generateRegistrationOptions({
        rpName: this.rpName,
        rpID: this.rpID,
        userID: user.id,
        userName: userEmail,
        userDisplayName: userName || userEmail,
        timeout: this.timeouts.registration, // 設定可能なタイムアウト
        attestationType: 'none',
        excludeCredentials,
        authenticatorSelection: {
          userVerification: 'preferred',
          residentKey: 'required',
          requireResidentKey: true
        },
        supportedAlgorithmIDs: [-7, -257]
      });

      // チャレンジを保存
      const expiresAt = new Date(Date.now() + this.timeouts.challengeExpiry).toISOString();
      await this.db.saveChallenge(options.challenge, user.id, 'registration', expiresAt);

      // 成功をログ記録
      const duration = Date.now() - startTime;
      this.errorLogger.logSuccess({
        operation,
        userId: user.id,
        email: userEmail,
        duration,
        context: {
          timeout: this.timeouts.registration,
          existingCredentials: existingCredentials.length,
        },
      });

      console.log(`[auth] Registration options generated for user ${user.id} (${duration}ms)`);

      return {
        success: true,
        options,
        userId: user.id,
        metadata: {
          timeout: this.timeouts.registration,
          expiresAt: Date.now() + this.timeouts.challengeExpiry,
        },
      };

    } catch (error) {
      // エラーをログ記録
      const sessionId = this.errorLogger.logAuthError({
        error,
        operation,
        userId: null,
        email: userEmail,
        context: {
          timeout: this.timeouts.registration,
        },
      });

      console.error(`[auth] ${operation} error:`, error.message);
      throw error;
    }
  }

  async verifyRegistration(userId, registrationResponse, userAgent = null) {
    const operation = 'verifyRegistration';
    const startTime = Date.now();

    try {
      console.log(`[auth] Verifying registration for user: ${userId}`);
      console.log(`[auth] Registration response keys:`, Object.keys(registrationResponse));
      console.log(`[auth] Response type:`, registrationResponse.type);
      console.log(`[auth] Response id:`, registrationResponse.id);

      // ユーザーとチャレンジを取得
      const user = await this.db.getUserById(userId);
      if (!user) {
        console.error(`[auth] User not found: ${userId}`);
        throw new Error('User not found');
      }
      console.log(`[auth] Found user:`, user.email);

      // clientDataJSONからchallengeを抽出
      const clientData = JSON.parse(new TextDecoder().decode(
        Uint8Array.from(atob(registrationResponse.response.clientDataJSON), c => c.charCodeAt(0))
      ));
      console.log(`[auth] Extracted challenge from clientData:`, clientData.challenge);

      const challengeRecord = await this.db.getChallenge(clientData.challenge);
      if (!challengeRecord) {
        console.error(`[auth] Challenge not found for challenge: ${clientData.challenge}`);
        throw new Error('Challenge not found or expired. Please try registering again.');
      }
      if (challengeRecord.user_id !== userId) {
        console.error(`[auth] Challenge user mismatch: expected ${userId}, got ${challengeRecord.user_id}`);
        throw new Error('Challenge user mismatch');
      }
      console.log(`[auth] Challenge verification passed`);

      // 登録レスポンスを検証
      console.log(`[auth] Verifying registration with:`, {
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID
      });

      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: registrationResponse,
          expectedChallenge: challengeRecord.challenge,
          expectedOrigin: this.origin,
          expectedRPID: this.rpID,
          requireUserVerification: false
        });
      } catch (verifyError) {
        // WebAuthn固有のエラーをログ記録
        const sessionId = this.errorLogger.logWebAuthnError({
          error: verifyError,
          phase: 'registration',
          userId,
          email: user.email,
          expectedChallenge: challengeRecord.challenge,
          receivedData: registrationResponse,
          context: {
            origin: this.origin,
            rpId: this.rpID,
            timeout: this.timeouts.registration,
            userAgent,
          },
        });

        throw new Error(`Verification failed: ${verifyError.message} (Session: ${sessionId})`);
      }

      console.log(`[auth] Verification result:`, verification);

      if (verification.verified && verification.registrationInfo) {
        // 認証情報をデータベースに保存
        const { credentialID, credentialPublicKey, counter, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

        const credentialIDBase64 = Buffer.from(credentialID).toString('base64');
        const publicKeyBase64 = Buffer.from(credentialPublicKey).toString('base64');

        console.log(`[auth] Saving credential with ID (base64):`, credentialIDBase64);

        await this.db.saveCredential(userId, {
          id: credentialIDBase64,
          publicKey: publicKeyBase64,
          counter,
          deviceType: credentialDeviceType || 'singleDevice',
          backedUp: credentialBackedUp || false,
          transports: registrationResponse.response.transports || []
        });

        // チャレンジを削除
        await this.db.deleteChallenge(challengeRecord.challenge);

        // 成功をログ記録
        const duration = Date.now() - startTime;
        this.errorLogger.logSuccess({
          operation,
          userId,
          email: user.email,
          duration,
          context: {
            credentialId: credentialIDBase64,
            deviceType: credentialDeviceType,
            backedUp: credentialBackedUp,
          },
        });

        console.log(`[auth] Registration verified and saved for user ${userId} (${duration}ms)`);

        return {
          success: true,
          verified: true,
          message: 'Passkey registration successful',
          duration,
        };
      } else {
        throw new Error('Registration verification failed');
      }

    } catch (error) {
      console.error('[auth] Registration verification error:', error);

      // タイムアウトエラーのチェック
      const duration = Date.now() - startTime;
      if (duration > this.timeouts.registration) {
        const user = await this.db.getUserById(userId).catch(() => null);
        this.errorLogger.logTimeoutError({
          operation,
          userId,
          email: user?.email,
          timeout: this.timeouts.registration,
          startTime,
          context: { userAgent },
        });
      }

      return {
        success: false,
        verified: false,
        message: this.getUserFriendlyErrorMessage(error, 'registration'),
        canRetry: this.canRetryError(error),
      };
    }
  }

  // ========================================
  // 認証フロー（エラーログ統合版）
  // ========================================

  async generateAuthenticationOptions(userEmail = null) {
    const operation = 'generateAuthenticationOptions';
    const startTime = Date.now();

    try {
      console.log(`[auth] Generating authentication options for: ${userEmail || 'any user'}`);

      let allowCredentials = undefined;
      let user = null;

      if (userEmail) {
        // 特定ユーザーの認証情報を取得
        user = await this.db.getUserByEmail(userEmail);
        if (user) {
          const credentials = await this.db.getUserCredentials(user.id);
          if (credentials.length === 0) {
            throw new Error('No credentials found for this user. Please register first.');
          }
          allowCredentials = credentials.map(cred => ({
            id: cred.credential_id,
            type: 'public-key',
            transports: cred.transports
          }));
        }
      }

      const options = await generateAuthenticationOptions({
        rpID: this.rpID,
        allowCredentials,
        userVerification: 'preferred',
        timeout: this.timeouts.authentication, // 設定可能なタイムアウト
      });

      // チャレンジを保存
      const expiresAt = new Date(Date.now() + this.timeouts.challengeExpiry).toISOString();
      await this.db.saveChallenge(options.challenge, userEmail || null, 'authentication', expiresAt);

      // 成功をログ記録
      const duration = Date.now() - startTime;
      this.errorLogger.logSuccess({
        operation,
        userId: user?.id,
        email: userEmail,
        duration,
        context: {
          timeout: this.timeouts.authentication,
          credentialCount: allowCredentials?.length || 0,
        },
      });

      console.log(`[auth] Authentication options generated (${duration}ms)`);

      return {
        success: true,
        options,
        metadata: {
          timeout: this.timeouts.authentication,
          expiresAt: Date.now() + this.timeouts.challengeExpiry,
        },
      };

    } catch (error) {
      // エラーをログ記録
      const sessionId = this.errorLogger.logAuthError({
        error,
        operation,
        userId: null,
        email: userEmail,
        context: {
          timeout: this.timeouts.authentication,
        },
      });

      console.error(`[auth] ${operation} error:`, error.message);
      throw error;
    }
  }

  async verifyAuthentication(authenticationResponse, userAgent = null) {
    const operation = 'verifyAuthentication';
    const startTime = Date.now();

    try {
      console.log(`[auth] Verifying authentication`);
      console.log(`[auth] Authentication response ID:`, authenticationResponse.id);

      const { id: credentialID } = authenticationResponse;

      console.log(`[auth] Looking for credential with ID:`, credentialID);

      // 認証情報を取得
      const credential = await this.db.getCredentialByCredentialId(credentialID);
      if (!credential) {
        console.error(`[auth] Credential not found for ID:`, credentialID);
        throw new Error('Credential not found');
      }
      console.log(`[auth] Found credential for user:`, credential.user_id);

      // ユーザー情報を取得
      const user = await this.db.getUserById(credential.user_id);
      if (!user) {
        throw new Error('User not found');
      }

      // clientDataJSONからchallengeを抽出
      const clientData = JSON.parse(new TextDecoder().decode(
        Uint8Array.from(atob(authenticationResponse.response.clientDataJSON), c => c.charCodeAt(0))
      ));

      // チャレンジを取得
      const challengeRecord = await this.db.getChallenge(clientData.challenge);
      if (!challengeRecord) {
        throw new Error('Challenge not found or expired. Please try authenticating again.');
      }

      // Base64からUint8Arrayに変換
      const credentialIDBytes = Buffer.from(credential.credential_id, 'base64');
      const credentialPublicKeyBytes = Buffer.from(credential.credential_public_key, 'base64');

      console.log(`[auth] Converting credential from Base64 for verification`);

      // 認証レスポンスを検証
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: authenticationResponse,
          expectedChallenge: challengeRecord.challenge,
          expectedOrigin: this.origin,
          expectedRPID: this.rpID,
          authenticator: {
            credentialID: credentialIDBytes,
            credentialPublicKey: credentialPublicKeyBytes,
            counter: credential.counter,
            transports: JSON.parse(credential.transports || '[]')
          },
          requireUserVerification: false
        });
      } catch (verifyError) {
        // WebAuthn固有のエラーをログ記録
        const sessionId = this.errorLogger.logWebAuthnError({
          error: verifyError,
          phase: 'authentication',
          userId: user.id,
          email: user.email,
          expectedChallenge: challengeRecord.challenge,
          receivedData: authenticationResponse,
          context: {
            origin: this.origin,
            rpId: this.rpID,
            timeout: this.timeouts.authentication,
            userAgent,
            credentialId: credentialID,
          },
        });

        throw new Error(`Verification failed: ${verifyError.message} (Session: ${sessionId})`);
      }

      if (verification.verified) {
        // カウンターを更新
        await this.db.updateCredentialCounter(credentialID, verification.authenticationInfo.newCounter);

        // 最終ログイン時刻を更新
        await this.db.updateLastLogin(user.id);

        // チャレンジを削除
        await this.db.deleteChallenge(challengeRecord.challenge);

        // セッションを作成
        const sessionData = {
          userId: user.id,
          email: user.email,
          displayName: user.display_name,
          authenticatedAt: new Date().toISOString()
        };

        const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24時間
        const sessionId = await this.db.createSession(user.id, sessionData, sessionExpiresAt);

        // 成功をログ記録
        const duration = Date.now() - startTime;
        this.errorLogger.logSuccess({
          operation,
          userId: user.id,
          email: user.email,
          duration,
          context: {
            credentialId: credentialID,
            newCounter: verification.authenticationInfo.newCounter,
          },
        });

        console.log(`[auth] Authentication verified for user ${user.id} (${duration}ms)`);

        return {
          success: true,
          verified: true,
          user: {
            id: user.id,
            email: user.email,
            displayName: user.display_name
          },
          sessionId,
          message: 'Authentication successful',
          duration,
        };
      } else {
        throw new Error('Authentication verification failed');
      }

    } catch (error) {
      console.error('[auth] Authentication verification error:', error);

      // タイムアウトエラーのチェック
      const duration = Date.now() - startTime;
      if (duration > this.timeouts.authentication) {
        this.errorLogger.logTimeoutError({
          operation,
          userId: null,
          email: null,
          timeout: this.timeouts.authentication,
          startTime,
          context: { userAgent },
        });
      }

      return {
        success: false,
        verified: false,
        message: this.getUserFriendlyErrorMessage(error, 'authentication'),
        canRetry: this.canRetryError(error),
      };
    }
  }

  // ========================================
  // セッション管理（既存のまま）
  // ========================================

  async validateSession(sessionId) {
    try {
      if (!sessionId) {
        return { valid: false, message: 'No session ID provided' };
      }

      const session = await this.db.getSession(sessionId);
      if (!session) {
        return { valid: false, message: 'Session not found or expired' };
      }

      const user = await this.db.getUserById(session.user_id);
      if (!user) {
        await this.db.deleteSession(sessionId);
        return { valid: false, message: 'User not found' };
      }

      return {
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: user.role || 'user'
        },
        sessionData: session.session_data
      };

    } catch (error) {
      console.error('[auth] Session validation error:', error);
      return { valid: false, message: 'Session validation failed' };
    }
  }

  async logout(sessionId) {
    try {
      if (sessionId) {
        await this.db.deleteSession(sessionId);
        console.log(`[auth] Session ${sessionId} logged out`);
      }
      return { success: true };
    } catch (error) {
      console.error('[auth] Logout error:', error);
      return { success: false, message: error.message };
    }
  }

  // ========================================
  // クリーンアップ（既存のまま）
  // ========================================

  async cleanup() {
    try {
      await this.db.cleanupExpiredSessions();
      await this.db.cleanupExpiredChallenges();
    } catch (error) {
      console.error('[auth] Cleanup error:', error);
    }
  }

  // ========================================
  // ヘルパーメソッド（新規追加）
  // ========================================

  /**
   * メールアドレスの検証
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * エラーがリトライ可能かどうかを判定
   */
  canRetryError(error) {
    const retryableErrors = [
      'timeout',
      'timed out',
      'network',
      'Challenge not found',
      'expired',
    ];

    const message = error.message.toLowerCase();
    return retryableErrors.some(keyword => message.includes(keyword));
  }

  /**
   * ユーザーフレンドリーなエラーメッセージに変換
   */
  getUserFriendlyErrorMessage(error, operation) {
    const message = error.message.toLowerCase();

    if (message.includes('timeout') || message.includes('timed out')) {
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

    // デフォルトメッセージ
    return `認証エラーが発生しました: ${error.message}。問題が解決しない場合は、サポートにお問い合わせください。`;
  }

  /**
   * エラー統計を取得
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

export default PasskeyAuthenticator;
