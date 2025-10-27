/**
 * Comprehensive Error Logging System (ES6 Module Version)
 *
 * このモジュールは認証システムの詳細なエラー追跡とログ記録を提供します。
 * WebAuthnエラー、タイムアウト、一般的な認証エラーを包括的に記録します。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
   * 認証エラーを詳細にログ記録
   * @param {Object} params - エラーパラメータ
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
   * WebAuthn固有のエラーをログ記録
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
        troubleshooting: errorData.troubleshooting.slice(0, 2), // 最初の2つだけ表示
      });
    }

    return errorData.sessionId;
  }

  /**
   * タイムアウトエラーを詳細にログ記録
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
   * 成功した操作をログ記録（比較用）
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
   * ログファイルに書き込み（ローテーション付き）
   */
  writeLog(category, data) {
    if (!this.enableFile) return;

    const logFile = path.join(this.logDir, `${category}.log`);
    const logLine = JSON.stringify(data) + '\n';

    try {
      // ファイルサイズをチェックしてローテーション
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
   * ログファイルをローテーション
   */
  rotateLog(logFile) {
    try {
      const ext = path.extname(logFile);
      const basename = path.basename(logFile, ext);
      const dirname = path.dirname(logFile);

      // 既存のローテーションログをシフト
      for (let i = this.maxLogFiles - 1; i > 0; i--) {
        const oldFile = path.join(dirname, `${basename}.${i}${ext}`);
        const newFile = path.join(dirname, `${basename}.${i + 1}${ext}`);
        if (fs.existsSync(oldFile)) {
          fs.renameSync(oldFile, newFile);
        }
      }

      // 現在のログをローテーション
      const rotatedFile = path.join(dirname, `${basename}.1${ext}`);
      fs.renameSync(logFile, rotatedFile);

      console.log(`[errorLogger] Rotated log file: ${logFile}`);
    } catch (err) {
      console.error('[errorLogger] Failed to rotate log:', err.message);
    }
  }

  /**
   * WebAuthn固有のトラブルシューティング情報を生成
   */
  getWebAuthnTroubleshooting(error) {
    const message = error.message.toLowerCase();
    const tips = [];

    if (message.includes('timeout') || message.includes('timed out')) {
      tips.push('ユーザーの認証操作時間が不足しています。タイムアウトを延長してください（推奨: 登録120秒、認証90秒）');
      tips.push('ユーザーが認証デバイス（指紋、顔認証など）の操作に慣れていない可能性があります');
      tips.push('ネットワーク遅延が原因の可能性があります。ネットワーク接続を確認してください');
    }

    if (message.includes('not allowed') || message.includes('notallowederror')) {
      tips.push('ユーザーが認証をキャンセルした、またはブラウザがリクエストをブロックしました');
      tips.push('HTTPSではなくHTTPで実行されている可能性があります（本番環境ではHTTPS必須）');
      tips.push('クロスオリジンの問題が発生している可能性があります。ALLOWED_ORIGINSを確認してください');
      tips.push('ユーザージェスチャー（クリックなど）なしで認証が開始された可能性があります');
    }

    if (message.includes('challenge')) {
      tips.push('チャレンジの検証に失敗しました。セッション管理を確認してください');
      tips.push('チャレンジの有効期限が切れている可能性があります（デフォルト5分）');
      tips.push('ユーザーがページを再読み込みした可能性があります');
    }

    if (message.includes('origin')) {
      tips.push('オリジンの設定が正しくありません。ALLOWED_ORIGINSとRP_IDを確認してください');
      tips.push('本番環境とローカル環境で異なる設定が必要です');
    }

    if (message.includes('credential') && message.includes('not found')) {
      tips.push('認証情報がデータベースに見つかりません');
      tips.push('ユーザーが別のデバイスで登録した可能性があります');
    }

    if (tips.length === 0) {
      tips.push('予期しないエラーです。詳細なログを確認してください');
      tips.push('問題が解決しない場合は、データベースの整合性を確認してください');
    }

    return tips;
  }

  /**
   * タイムアウト固有の推奨事項を生成
   */
  getTimeoutRecommendations(configuredTimeout, actualDuration) {
    const recommendations = [];

    if (actualDuration && actualDuration > configuredTimeout) {
      const ratio = actualDuration / configuredTimeout;
      if (ratio > 1.5) {
        const recommended = Math.ceil(actualDuration / 1000) + 10;
        recommendations.push(`タイムアウトを${recommended}秒以上に延長することを推奨します`);
      }
    }

    recommendations.push('登録: 120-180秒、認証: 90-120秒のタイムアウトを推奨します');
    recommendations.push('認証前にユーザーに明確な指示を表示してください');
    recommendations.push('リトライメカニズムを実装してください');
    recommendations.push('環境変数 REGISTRATION_TIMEOUT と AUTHENTICATION_TIMEOUT で調整できます');

    return recommendations;
  }

  /**
   * User-Agentをパース
   */
  parseUserAgent(userAgent) {
    return {
      full: userAgent,
      isMobile: /mobile|android|ios|iphone|ipad/i.test(userAgent),
      browser: this.getBrowserName(userAgent),
    };
  }

  getBrowserName(userAgent) {
    if (/edg/i.test(userAgent)) return 'Edge';
    if (/chrome/i.test(userAgent)) return 'Chrome';
    if (/firefox/i.test(userAgent)) return 'Firefox';
    if (/safari/i.test(userAgent)) return 'Safari';
    return 'Unknown';
  }

  /**
   * メールアドレスをマスキング（プライバシー保護）
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
   * 長い文字列を切り詰め
   */
  truncate(str, maxLength) {
    if (!str || str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
  }

  /**
   * ユニークなセッションIDを生成
   */
  generateSessionId() {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * エラー統計を取得
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
        // 操作別カウント
        const op = error.operation || 'unknown';
        stats.byOperation[op] = (stats.byOperation[op] || 0) + 1;

        // エラータイプ別カウント
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

export default ErrorLogger;
