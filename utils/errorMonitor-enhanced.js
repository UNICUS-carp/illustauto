/**
 * Error Monitoring and Alerting System (ES6 Module Version)
 *
 * エラー率を監視し、閾値を超えた場合にアラートを送信します。
 * 認証エラーのパターンを識別し、問題の早期発見を支援します。
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ErrorMonitor {
  constructor(config = {}) {
    this.enabled = config.enabled !== false;
    this.logDir = config.logDir || path.join(__dirname, '..', 'logs');
    this.checkInterval = config.checkInterval || 300000; // 5分
    this.errorRateThreshold = config.errorRateThreshold || 10; // 1時間あたりのエラー数
    this.webhookUrl = config.webhookUrl;
    this.enableWebhookNotifications = config.enableWebhookNotifications && this.webhookUrl;

    this.errorCounts = {
      'auth-error': [],
      'webauthn-error': [],
      'timeout-error': [],
    };

    this.lastAlertTime = {};
    this.alertCooldown = 3600000; // 1時間（重複アラート防止）

    if (this.enabled) {
      this.startMonitoring();
      console.log('[errorMonitor] Monitoring started');
    }
  }

  /**
   * エラーログの監視を開始
   */
  startMonitoring() {
    // 初回チェックを実行
    this.checkErrorRates();

    // 定期的なチェックを設定
    this.monitorInterval = setInterval(() => {
      this.checkErrorRates();
    }, this.checkInterval);

    // 終了時のクリーンアップ
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  /**
   * 監視を停止
   */
  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      console.log('[errorMonitor] Monitoring stopped');
    }
  }

  /**
   * 全カテゴリのエラー率をチェック
   */
  async checkErrorRates() {
    try {
      const results = await Promise.all([
        this.analyzeErrorLog('auth-error'),
        this.analyzeErrorLog('webauthn-error'),
        this.analyzeErrorLog('timeout-error'),
      ]);

      results.forEach(result => {
        if (result && result.shouldAlert) {
          this.sendAlert(result);
        }
      });
    } catch (error) {
      console.error('[errorMonitor] Failed to check error rates:', error.message);
    }
  }

  /**
   * 特定カテゴリのエラーログを分析
   */
  async analyzeErrorLog(category) {
    const logFile = path.join(this.logDir, `${category}.log`);

    if (!fs.existsSync(logFile)) {
      return null;
    }

    try {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line);

      // 過去1時間のエラーを分析
      const oneHourAgo = Date.now() - 3600000;
      const recentErrors = lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(log => {
          if (!log) return false;
          const timestamp = new Date(log.timestamp).getTime();
          return timestamp > oneHourAgo;
        });

      const errorRate = recentErrors.length;
      const shouldAlert = errorRate >= this.errorRateThreshold;

      if (shouldAlert && this.canSendAlert(category)) {
        const patterns = this.identifyErrorPatterns(recentErrors);

        return {
          category,
          errorRate,
          threshold: this.errorRateThreshold,
          shouldAlert: true,
          patterns,
          recentErrors: recentErrors.slice(-5), // 最新5件のエラー
        };
      }

      return {
        category,
        errorRate,
        threshold: this.errorRateThreshold,
        shouldAlert: false,
      };
    } catch (error) {
      console.error(`[errorMonitor] Failed to analyze ${category}:`, error.message);
      return null;
    }
  }

  /**
   * エラーのパターンを識別
   */
  identifyErrorPatterns(errors) {
    const patterns = {
      byErrorType: {},
      byOperation: {},
      byTimeOfDay: {},
      commonMessages: {},
    };

    errors.forEach(error => {
      // エラータイプ別
      const errorType = error.error?.name || 'unknown';
      patterns.byErrorType[errorType] = (patterns.byErrorType[errorType] || 0) + 1;

      // 操作別
      const operation = error.operation || 'unknown';
      patterns.byOperation[operation] = (patterns.byOperation[operation] || 0) + 1;

      // 時間帯別
      const hour = new Date(error.timestamp).getHours();
      patterns.byTimeOfDay[hour] = (patterns.byTimeOfDay[hour] || 0) + 1;

      // 共通エラーメッセージ
      const message = error.error?.message || 'unknown';
      const shortMessage = message.substring(0, 50);
      patterns.commonMessages[shortMessage] = (patterns.commonMessages[shortMessage] || 0) + 1;
    });

    return patterns;
  }

  /**
   * アラート送信可能かチェック（クールダウン）
   */
  canSendAlert(category) {
    const lastAlert = this.lastAlertTime[category];
    if (!lastAlert) return true;

    const timeSinceLastAlert = Date.now() - lastAlert;
    return timeSinceLastAlert > this.alertCooldown;
  }

  /**
   * アラート通知を送信
   */
  sendAlert(alertData) {
    const { category, errorRate, threshold, patterns } = alertData;

    console.warn('[errorMonitor] ⚠️ ERROR RATE ALERT ⚠️');
    console.warn(`Category: ${category}`);
    console.warn(`Error Rate: ${errorRate} errors/hour (threshold: ${threshold})`);
    console.warn(`Top Error Types:`, Object.entries(patterns.byErrorType).slice(0, 3));

    // 最終アラート時刻を更新
    this.lastAlertTime[category] = Date.now();

    // Webhook通知を送信（有効な場合）
    if (this.enableWebhookNotifications) {
      this.sendWebhookNotification(alertData);
    }

    // アラートをファイルに記録
    this.logAlert(alertData);
  }

  /**
   * Webhook通知を送信
   */
  async sendWebhookNotification(alertData) {
    if (!this.webhookUrl) return;

    const { category, errorRate, threshold, patterns } = alertData;

    const payload = {
      text: `🚨 認証システムエラーアラート`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 認証システムエラーアラート',
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*カテゴリ:*\n${category}`,
            },
            {
              type: 'mrkdwn',
              text: `*エラー率:*\n${errorRate}/時間`,
            },
            {
              type: 'mrkdwn',
              text: `*閾値:*\n${threshold}/時間`,
            },
            {
              type: 'mrkdwn',
              text: `*時刻:*\n${new Date().toLocaleString('ja-JP')}`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*主なエラータイプ:*\n${Object.entries(patterns.byErrorType).slice(0, 5).map(([type, count]) => `• ${type}: ${count}回`).join('\n')}`,
          },
        },
      ],
    };

    try {
      await this.sendHttpRequest(this.webhookUrl, payload);
      console.log('[errorMonitor] Webhook notification sent');
    } catch (error) {
      console.error('[errorMonitor] Failed to send webhook notification:', error.message);
    }
  }

  /**
   * HTTPリクエストを送信（Webhook用）
   */
  sendHttpRequest(url, payload) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = protocol.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.write(JSON.stringify(payload));
      req.end();
    });
  }

  /**
   * アラートをファイルに記録
   */
  logAlert(alertData) {
    const alertFile = path.join(this.logDir, 'alerts.log');
    const alertLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...alertData,
    }) + '\n';

    try {
      fs.appendFileSync(alertFile, alertLine, 'utf8');
    } catch (error) {
      console.error('[errorMonitor] Failed to log alert:', error.message);
    }
  }

  /**
   * 監視ステータスを取得
   */
  getStatus() {
    return {
      enabled: this.enabled,
      checkInterval: this.checkInterval,
      errorRateThreshold: this.errorRateThreshold,
      webhookEnabled: this.enableWebhookNotifications,
      lastAlerts: this.lastAlertTime,
    };
  }

  /**
   * エラーサマリーを取得（ダッシュボード用）
   */
  async getErrorSummary(hours = 24) {
    const summaries = await Promise.all([
      this.getErrorSummaryByCategory('auth-error', hours),
      this.getErrorSummaryByCategory('webauthn-error', hours),
      this.getErrorSummaryByCategory('timeout-error', hours),
    ]);

    const [authErrors, webauthnErrors, timeoutErrors] = summaries;

    const totalErrors = (authErrors?.count || 0) + (webauthnErrors?.count || 0) + (timeoutErrors?.count || 0);

    return {
      period: `Last ${hours} hours`,
      totalErrors,
      byCategory: {
        authentication: authErrors,
        webauthn: webauthnErrors,
        timeout: timeoutErrors,
      },
      trends: this.calculateTrends(summaries),
    };
  }

  /**
   * 特定カテゴリのエラーサマリーを取得
   */
  async getErrorSummaryByCategory(category, hours) {
    const logFile = path.join(this.logDir, `${category}.log`);

    if (!fs.existsSync(logFile)) {
      return { category, count: 0, errors: [] };
    }

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
        .filter(log => {
          if (!log) return false;
          const timestamp = new Date(log.timestamp).getTime();
          return timestamp > cutoffTime;
        });

      return {
        category,
        count: recentErrors.length,
        errors: recentErrors.slice(-10), // 最新10件
        patterns: this.identifyErrorPatterns(recentErrors),
      };
    } catch (error) {
      console.error(`[errorMonitor] Failed to get summary for ${category}:`, error.message);
      return { category, count: 0, errors: [] };
    }
  }

  /**
   * エラートレンドを計算
   */
  calculateTrends(summaries) {
    const trends = {
      increasing: [],
      stable: [],
      decreasing: [],
    };

    summaries.forEach(summary => {
      if (!summary) return;

      const { category, count } = summary;
      const hourlyRate = count / 24;

      if (hourlyRate > this.errorRateThreshold) {
        trends.increasing.push(category);
      } else if (hourlyRate > this.errorRateThreshold / 2) {
        trends.stable.push(category);
      } else {
        trends.decreasing.push(category);
      }
    });

    return trends;
  }
}

export default ErrorMonitor;
