/**
 * Comprehensive Error Logging System
 *
 * This module provides detailed error tracking and logging for the authentication system.
 * It captures contextual information, stack traces, and provides structured error reporting.
 */

const fs = require('fs');
const path = require('path');

class ErrorLogger {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(__dirname, '..', 'logs');
    this.maxLogSize = options.maxLogSize || 10 * 1024 * 1024; // 10MB
    this.maxLogFiles = options.maxLogFiles || 10;
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;

    this.initializeLogDirectory();
  }

  initializeLogDirectory() {
    if (this.enableFile && !fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
      console.log(`[errorLogger] Log directory created: ${this.logDir}`);
    }
  }

  /**
   * Log an authentication error with full context
   * @param {Object} params - Error parameters
   * @param {Error} params.error - The error object
   * @param {string} params.operation - The operation being performed
   * @param {string} params.userId - User ID (if available)
   * @param {string} params.email - User email (if available)
   * @param {Object} params.context - Additional context
   */
  logAuthError({ error, operation, userId, email, context = {} }) {
    const timestamp = new Date().toISOString();
    const errorData = {
      timestamp,
      level: 'ERROR',
      category: 'AUTHENTICATION',
      operation,
      userId,
      email: this.maskEmail(email),
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack,
      },
      context: {
        ...context,
        userAgent: context.userAgent ? this.parseUserAgent(context.userAgent) : null,
      },
      sessionId: this.generateSessionId(),
    };

    this.writeLog('auth-error', errorData);

    if (this.enableConsole) {
      console.error(`[AUTH ERROR] ${operation}:`, {
        error: error.message,
        userId,
        email: this.maskEmail(email),
        code: error.code,
      });
    }

    return errorData.sessionId;
  }

  /**
   * Log a WebAuthn-specific error
   * @param {Object} params - WebAuthn error parameters
   */
  logWebAuthnError({ error, phase, userId, email, expectedChallenge, receivedData, context = {} }) {
    const timestamp = new Date().toISOString();
    const errorData = {
      timestamp,
      level: 'ERROR',
      category: 'WEBAUTHN',
      phase, // 'registration' or 'authentication'
      userId,
      email: this.maskEmail(email),
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack,
      },
      webAuthnDetails: {
        expectedChallenge: expectedChallenge ? this.truncate(expectedChallenge, 20) : null,
        receivedDataKeys: receivedData ? Object.keys(receivedData) : null,
        authenticatorType: receivedData?.authenticatorAttachment,
        clientExtensions: receivedData?.clientExtensionResults,
      },
      context: {
        ...context,
        origin: context.origin,
        rpId: context.rpId,
        timeout: context.timeout,
      },
      troubleshooting: this.getWebAuthnTroubleshooting(error),
      sessionId: this.generateSessionId(),
    };

    this.writeLog('webauthn-error', errorData);

    if (this.enableConsole) {
      console.error(`[WEBAUTHN ERROR] ${phase}:`, {
        error: error.message,
        email: this.maskEmail(email),
        troubleshooting: errorData.troubleshooting,
      });
    }

    return errorData.sessionId;
  }

  /**
   * Log a timeout error with detailed timing information
   */
  logTimeoutError({ operation, userId, email, timeout, startTime, context = {} }) {
    const timestamp = new Date().toISOString();
    const duration = startTime ? Date.now() - startTime : null;

    const errorData = {
      timestamp,
      level: 'ERROR',
      category: 'TIMEOUT',
      operation,
      userId,
      email: this.maskEmail(email),
      timing: {
        configuredTimeout: timeout,
        actualDuration: duration,
        exceededBy: duration ? duration - timeout : null,
      },
      context,
      recommendations: this.getTimeoutRecommendations(timeout, duration),
      sessionId: this.generateSessionId(),
    };

    this.writeLog('timeout-error', errorData);

    if (this.enableConsole) {
      console.error(`[TIMEOUT ERROR] ${operation}:`, {
        timeout,
        duration,
        email: this.maskEmail(email),
      });
    }

    return errorData.sessionId;
  }

  /**
   * Log successful operations for comparison with errors
   */
  logSuccess({ operation, userId, email, duration, context = {} }) {
    const timestamp = new Date().toISOString();
    const successData = {
      timestamp,
      level: 'INFO',
      category: 'SUCCESS',
      operation,
      userId,
      email: this.maskEmail(email),
      duration,
      context,
    };

    this.writeLog('success', successData);

    if (this.enableConsole) {
      console.log(`[SUCCESS] ${operation}:`, {
        email: this.maskEmail(email),
        duration: `${duration}ms`,
      });
    }
  }

  /**
   * Write log to file with rotation
   */
  writeLog(category, data) {
    if (!this.enableFile) return;

    const logFile = path.join(this.logDir, `${category}.log`);
    const logLine = JSON.stringify(data) + '\n';

    try {
      // Check file size and rotate if necessary
      if (fs.existsSync(logFile)) {
        const stats = fs.statSync(logFile);
        if (stats.size > this.maxLogSize) {
          this.rotateLog(logFile);
        }
      }

      fs.appendFileSync(logFile, logLine, 'utf8');
    } catch (err) {
      console.error('[errorLogger] Failed to write log:', err.message);
    }
  }

  /**
   * Rotate log files
   */
  rotateLog(logFile) {
    try {
      const ext = path.extname(logFile);
      const basename = path.basename(logFile, ext);
      const dirname = path.dirname(logFile);

      // Shift existing rotated logs
      for (let i = this.maxLogFiles - 1; i > 0; i--) {
        const oldFile = path.join(dirname, `${basename}.${i}${ext}`);
        const newFile = path.join(dirname, `${basename}.${i + 1}${ext}`);
        if (fs.existsSync(oldFile)) {
          fs.renameSync(oldFile, newFile);
        }
      }

      // Rotate current log
      const rotatedFile = path.join(dirname, `${basename}.1${ext}`);
      fs.renameSync(logFile, rotatedFile);

      console.log(`[errorLogger] Rotated log file: ${logFile}`);
    } catch (err) {
      console.error('[errorLogger] Failed to rotate log:', err.message);
    }
  }

  /**
   * Get WebAuthn-specific troubleshooting tips
   */
  getWebAuthnTroubleshooting(error) {
    const message = error.message.toLowerCase();
    const tips = [];

    if (message.includes('timeout')) {
      tips.push('ユーザーの認証操作時間が不足しています。タイムアウトを延長してください。');
      tips.push('ユーザーが認証デバイス（指紋、顔認証など）の操作に慣れていない可能性があります。');
      tips.push('ネットワーク遅延が原因の可能性があります。');
    }

    if (message.includes('not allowed')) {
      tips.push('ユーザーが認証をキャンセルした、またはブラウザがリクエストをブロックしました。');
      tips.push('HTTPSではなくHTTPで実行されている可能性があります。');
      tips.push('クロスオリジンの問題が発生している可能性があります。');
      tips.push('ユーザージェスチャー（クリックなど）なしで認証が開始された可能性があります。');
    }

    if (message.includes('challenge')) {
      tips.push('チャレンジの検証に失敗しました。セッション管理を確認してください。');
      tips.push('チャレンジの有効期限が切れている可能性があります。');
    }

    if (message.includes('origin')) {
      tips.push('オリジンの設定が正しくありません。ALLOWED_ORIGINSを確認してください。');
    }

    if (tips.length === 0) {
      tips.push('予期しないエラーです。詳細なログを確認してください。');
    }

    return tips;
  }

  /**
   * Get timeout-specific recommendations
   */
  getTimeoutRecommendations(configuredTimeout, actualDuration) {
    const recommendations = [];

    if (actualDuration && actualDuration > configuredTimeout) {
      const ratio = actualDuration / configuredTimeout;
      if (ratio > 1.5) {
        recommendations.push(`タイムアウトを${Math.ceil(actualDuration / 1000) + 10}秒以上に延長することを推奨します。`);
      }
    }

    recommendations.push('ユーザーに十分な時間を提供するため、最低60秒のタイムアウトを設定してください。');
    recommendations.push('認証前にユーザーに明確な指示を表示してください。');
    recommendations.push('リトライメカニズムを実装してください。');

    return recommendations;
  }

  /**
   * Parse user agent for context
   */
  parseUserAgent(userAgent) {
    return {
      full: userAgent,
      isMobile: /mobile|android|ios|iphone|ipad/i.test(userAgent),
      browser: this.getBrowserName(userAgent),
    };
  }

  getBrowserName(userAgent) {
    if (/chrome/i.test(userAgent)) return 'Chrome';
    if (/firefox/i.test(userAgent)) return 'Firefox';
    if (/safari/i.test(userAgent)) return 'Safari';
    if (/edge/i.test(userAgent)) return 'Edge';
    return 'Unknown';
  }

  /**
   * Mask email for privacy
   */
  maskEmail(email) {
    if (!email) return null;
    const [local, domain] = email.split('@');
    if (!domain) return email;
    const maskedLocal = local.length > 2
      ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
      : local;
    return `${maskedLocal}@${domain}`;
  }

  /**
   * Truncate long strings
   */
  truncate(str, maxLength) {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  }

  /**
   * Generate unique session ID for error tracking
   */
  generateSessionId() {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get error statistics
   */
  async getErrorStatistics(category, hours = 24) {
    if (!this.enableFile) return null;

    const logFile = path.join(this.logDir, `${category}.log`);
    if (!fs.existsSync(logFile)) return null;

    try {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line);
      const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);

      const recentErrors = lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(log => log && new Date(log.timestamp).getTime() > cutoffTime);

      const stats = {
        total: recentErrors.length,
        byOperation: {},
        byErrorType: {},
        lastError: recentErrors[recentErrors.length - 1],
      };

      recentErrors.forEach(error => {
        // Count by operation
        const op = error.operation || 'unknown';
        stats.byOperation[op] = (stats.byOperation[op] || 0) + 1;

        // Count by error type
        const type = error.error?.name || 'unknown';
        stats.byErrorType[type] = (stats.byErrorType[type] || 0) + 1;
      });

      return stats;
    } catch (err) {
      console.error('[errorLogger] Failed to get statistics:', err.message);
      return null;
    }
  }
}

module.exports = ErrorLogger;
