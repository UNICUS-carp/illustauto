/**
 * Error Monitoring and Alerting System
 *
 * This module monitors error rates and sends alerts when thresholds are exceeded.
 * It helps identify patterns and recurring issues in the authentication system.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

class ErrorMonitor {
  constructor(config = {}) {
    this.enabled = config.enabled !== false;
    this.logDir = config.logDir || path.join(__dirname, '..', 'logs');
    this.checkInterval = config.checkInterval || 300000; // 5 minutes
    this.errorRateThreshold = config.errorRateThreshold || 10; // errors per hour
    this.webhookUrl = config.webhookUrl;
    this.enableWebhookNotifications = config.enableWebhookNotifications && this.webhookUrl;

    this.errorCounts = {
      'auth-error': [],
      'webauthn-error': [],
      'timeout-error': [],
    };

    this.lastAlertTime = {};
    this.alertCooldown = 3600000; // 1 hour between duplicate alerts

    if (this.enabled) {
      this.startMonitoring();
      console.log('[errorMonitor] Monitoring started');
    }
  }

  /**
   * Start monitoring error logs
   */
  startMonitoring() {
    // Run initial check
    this.checkErrorRates();

    // Set up periodic checks
    this.monitorInterval = setInterval(() => {
      this.checkErrorRates();
    }, this.checkInterval);

    // Cleanup on exit
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      console.log('[errorMonitor] Monitoring stopped');
    }
  }

  /**
   * Check error rates across all categories
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
   * Analyze a specific error log
   */
  async analyzeErrorLog(category) {
    const logFile = path.join(this.logDir, `${category}.log`);

    if (!fs.existsSync(logFile)) {
      return null;
    }

    try {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line);

      // Analyze last hour
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
          recentErrors: recentErrors.slice(-5), // Last 5 errors for context
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
   * Identify common patterns in errors
   */
  identifyErrorPatterns(errors) {
    const patterns = {
      byErrorType: {},
      byOperation: {},
      byTimeOfDay: {},
      commonMessages: {},
    };

    errors.forEach(error => {
      // By error type
      const errorType = error.error?.name || 'unknown';
      patterns.byErrorType[errorType] = (patterns.byErrorType[errorType] || 0) + 1;

      // By operation
      const operation = error.operation || 'unknown';
      patterns.byOperation[operation] = (patterns.byOperation[operation] || 0) + 1;

      // By time of day
      const hour = new Date(error.timestamp).getHours();
      patterns.byTimeOfDay[hour] = (patterns.byTimeOfDay[hour] || 0) + 1;

      // Common error messages
      const message = error.error?.message || 'unknown';
      const shortMessage = message.substring(0, 50);
      patterns.commonMessages[shortMessage] = (patterns.commonMessages[shortMessage] || 0) + 1;
    });

    return patterns;
  }

  /**
   * Check if we can send alert (cooldown)
   */
  canSendAlert(category) {
    const lastAlert = this.lastAlertTime[category];
    if (!lastAlert) return true;

    const timeSinceLastAlert = Date.now() - lastAlert;
    return timeSinceLastAlert > this.alertCooldown;
  }

  /**
   * Send alert notification
   */
  sendAlert(alertData) {
    const { category, errorRate, threshold, patterns, recentErrors } = alertData;

    console.warn('[errorMonitor] ⚠️ ERROR RATE ALERT ⚠️');
    console.warn(`Category: ${category}`);
    console.warn(`Error Rate: ${errorRate} errors/hour (threshold: ${threshold})`);
    console.warn(`Patterns:`, JSON.stringify(patterns, null, 2));

    // Update last alert time
    this.lastAlertTime[category] = Date.now();

    // Send webhook notification if enabled
    if (this.enableWebhookNotifications) {
      this.sendWebhookNotification(alertData);
    }

    // Log alert to file
    this.logAlert(alertData);
  }

  /**
   * Send webhook notification
   */
  async sendWebhookNotification(alertData) {
    if (!this.webhookUrl) return;

    const { category, errorRate, threshold, patterns, recentErrors } = alertData;

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
            text: `*エラーパターン:*\n\`\`\`${JSON.stringify(patterns, null, 2)}\`\`\``,
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
   * Send HTTP request (for webhook)
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
   * Log alert to file
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
   * Get monitoring status
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
   * Get error summary for dashboard
   */
  async getErrorSummary(hours = 24) {
    const summaries = await Promise.all([
      this.getErrorSummaryByCategory('auth-error', hours),
      this.getErrorSummaryByCategory('webauthn-error', hours),
      this.getErrorSummaryByCategory('timeout-error', hours),
    ]);

    const [authErrors, webauthnErrors, timeoutErrors] = summaries;

    return {
      period: `Last ${hours} hours`,
      totalErrors: (authErrors?.count || 0) + (webauthnErrors?.count || 0) + (timeoutErrors?.count || 0),
      byCategory: {
        authentication: authErrors,
        webauthn: webauthnErrors,
        timeout: timeoutErrors,
      },
      trends: this.calculateTrends(summaries),
    };
  }

  /**
   * Get error summary for a specific category
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
        errors: recentErrors,
        patterns: this.identifyErrorPatterns(recentErrors),
      };
    } catch (error) {
      console.error(`[errorMonitor] Failed to get summary for ${category}:`, error.message);
      return { category, count: 0, errors: [] };
    }
  }

  /**
   * Calculate error trends
   */
  calculateTrends(summaries) {
    const trends = {
      increasing: [],
      stable: [],
      decreasing: [],
    };

    // This is a simplified trend calculation
    // In production, you would compare with historical data

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

module.exports = ErrorMonitor;
