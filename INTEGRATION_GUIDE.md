# 統合ガイド - エラーログシステムの導入

このガイドでは、既存のIllustAutoシステムに新しいエラーログ機能を統合する手順を説明します。

## 📋 概要

以下のファイルを作成・更新しました：

### 新規作成ファイル（追加）
- `utils/errorLogger-enhanced.js` - エラーログシステム
- `utils/errorMonitor-enhanced.js` - エラー監視システム

### 強化版ファイル（既存ファイルの改良版）
- `auth-enhanced.js` - エラーログを統合した認証システム
- `config-enhanced.js` - タイムアウト設定を追加した設定管理

## 🔧 統合手順

### ステップ1: 新規ファイルの配置

```bash
# utilsディレクトリに新規ファイルを配置
cp utils/errorLogger-enhanced.js utils/errorLogger.js
cp utils/errorMonitor-enhanced.js utils/errorMonitor.js
```

### ステップ2: 既存ファイルのバックアップ

```bash
# 既存ファイルをバックアップ
cp auth.js auth.js.backup
cp config.js config.js.backup
```

### ステップ3: 強化版ファイルに置き換え

```bash
# 強化版ファイルに置き換え
cp auth-enhanced.js auth.js
cp config-enhanced.js config.js
```

### ステップ4: 環境変数の追加

`.env` ファイルに以下の設定を追加：

```env
# ========================================
# WebAuthn タイムアウト設定
# ========================================

# 登録タイムアウト（ミリ秒）
# 推奨: 120000-180000 (2-3分)
REGISTRATION_TIMEOUT=120000

# 認証タイムアウト（ミリ秒）
# 推奨: 90000-120000 (1.5-2分)
AUTHENTICATION_TIMEOUT=90000

# チャレンジ有効期限（ミリ秒）
# 推奨: 300000-600000 (5-10分)
CHALLENGE_EXPIRY=300000

# ========================================
# エラーログ設定
# ========================================

# ログディレクトリ
LOG_DIR=./logs

# コンソールログを有効化
ENABLE_CONSOLE_LOG=true

# ファイルログを有効化
ENABLE_FILE_LOG=true

# エラー率の閾値（1時間あたりのエラー数）
ERROR_RATE_THRESHOLD=10

# Webhook通知を有効化（オプション）
ENABLE_WEBHOOK_NOTIFICATIONS=false

# Webhook URL（Slack等）
# WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### ステップ5: server.jsの更新

既存の `server.js` に以下のインポートと初期化コードを追加：

```javascript
// ========================================
// 既存のインポート部分に追加
// ========================================
import ErrorMonitor from "./utils/errorMonitor.js";
import ConfigManager from "./config.js";

// ========================================
// 既存の初期化部分を更新
// ========================================
const config = new ConfigManager();
const configValidation = config.displayValidation(); // これは既存

// エラー監視システムの初期化（新規追加）
const errorLogConfig = config.getErrorLogConfig();
const errorMonitor = new ErrorMonitor({
  enabled: errorLogConfig.enableFile,
  logDir: errorLogConfig.logDir,
  errorRateThreshold: errorLogConfig.errorRateThreshold,
  webhookUrl: errorLogConfig.webhookUrl,
  enableWebhookNotifications: errorLogConfig.enableWebhook,
});

console.log('[app] Error monitoring initialized');

// ========================================
// 認証システムの初期化を更新
// ========================================
// 既存のauth初期化に設定を追加
const auth = new PasskeyAuthenticator(db, {
  logDir: errorLogConfig.logDir,
  enableConsoleLog: errorLogConfig.enableConsole,
  enableFileLog: errorLogConfig.enableFile,
});
```

### ステップ6: 監視エンドポイントの追加

`server.js` に以下のエンドポイントを追加：

```javascript
// ========================================
// エラー監視エンドポイント（新規追加）
// ========================================

/**
 * エラー監視ステータスと統計
 */
app.get("/api/monitoring/status", requireAuth, async (req, res) => {
  try {
    // 管理者のみアクセス可能
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    if (!adminEmails.includes(req.user.email)) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "管理者権限が必要です"
      });
    }

    const [monitorStatus, errorSummary, authStats] = await Promise.all([
      Promise.resolve(errorMonitor.getStatus()),
      errorMonitor.getErrorSummary(24),
      auth.getErrorStatistics(24),
    ]);

    res.json({
      success: true,
      monitor: monitorStatus,
      summary: errorSummary,
      stats: authStats,
      config: {
        timeouts: config.getTimeoutConfig(),
        errorLog: config.getErrorLogConfig(),
      },
    });
  } catch (error) {
    console.error('[api] Failed to get monitoring status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve monitoring status',
    });
  }
});

/**
 * エラーログの取得（管理者のみ）
 */
app.get("/api/monitoring/logs/:category", requireAuth, async (req, res) => {
  try {
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    if (!adminEmails.includes(req.user.email)) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "管理者権限が必要です"
      });
    }

    const { category } = req.params;
    const hours = parseInt(req.query.hours) || 24;

    const summary = await errorMonitor.getErrorSummaryByCategory(category, hours);

    res.json({
      success: true,
      category,
      summary,
    });
  } catch (error) {
    console.error('[api] Failed to get error logs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve error logs',
    });
  }
});
```

### ステップ7: 依存関係の確認

`package.json` に必要な依存関係が含まれていることを確認：

```json
{
  "dependencies": {
    "@simplewebauthn/server": "^9.0.0",
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "express-rate-limit": "^6.0.0"
  }
}
```

### ステップ8: テストと起動

```bash
# 依存関係のインストール
npm install

# サーバーの起動
npm start
```

## 📊 動作確認

### 1. 設定の確認

サーバー起動時に以下のようなログが表示されることを確認：

```
========================================
🔧 Configuration Validation Results
========================================

⏱️  Timeout Configuration:
   - Registration: 120000ms (120s)
   - Authentication: 90000ms (90s)
   - Challenge Expiry: 300000ms (300s)

📊 Error Logging Configuration:
   - Log Directory: ./logs
   - Console Logging: Enabled
   - File Logging: Enabled
   - Error Rate Threshold: 10 errors/hour
   - Webhook Notifications: Disabled

✅ Configuration is valid for startup
========================================

[auth] Initialized for unicus.top (production)
[auth] Timeouts: registration=120000ms, authentication=90000ms
[errorMonitor] Monitoring started
[app] Error monitoring initialized
```

### 2. エラーログの確認

認証エラーが発生した後、以下のディレクトリにログファイルが作成されることを確認：

```bash
ls -la logs/
# 出力例:
# auth-error.log
# webauthn-error.log
# timeout-error.log
# success.log
# alerts.log
```

### 3. 監視エンドポイントのテスト

管理者アカウントでログインし、以下のエンドポイントにアクセス：

```bash
curl -H "Authorization: Bearer YOUR_SESSION_ID" \
     http://localhost:3000/api/monitoring/status
```

**期待される応答:**

```json
{
  "success": true,
  "monitor": {
    "enabled": true,
    "checkInterval": 300000,
    "errorRateThreshold": 10,
    "webhookEnabled": false,
    "lastAlerts": {}
  },
  "summary": {
    "period": "Last 24 hours",
    "totalErrors": 5,
    "byCategory": {
      "authentication": { "count": 2, ... },
      "webauthn": { "count": 2, ... },
      "timeout": { "count": 1, ... }
    },
    "trends": {
      "increasing": [],
      "stable": [],
      "decreasing": ["auth-error"]
    }
  }
}
```

## 🎯 機能テスト

### タイムアウトエラーのテスト

1. `.env` でタイムアウトを短く設定（テスト用）：
   ```env
   AUTHENTICATION_TIMEOUT=5000  # 5秒
   ```

2. 認証を開始し、5秒以上待機

3. ログファイルを確認：
   ```bash
   tail -f logs/timeout-error.log
   ```

4. トラブルシューティング情報が記録されていることを確認

### エラー監視のテスト

1. 意図的に複数回エラーを発生させる（10回以上）

2. アラートログを確認：
   ```bash
   cat logs/alerts.log
   ```

3. エラー率の閾値を超えた場合、アラートが記録されることを確認

## ⚙️ 本番環境での推奨設定

```env
NODE_ENV=production

# タイムアウト設定（ゆとりを持たせる）
REGISTRATION_TIMEOUT=180000  # 3分
AUTHENTICATION_TIMEOUT=120000  # 2分
CHALLENGE_EXPIRY=600000  # 10分

# ログ設定
LOG_DIR=/var/log/illustauto
ENABLE_CONSOLE_LOG=true
ENABLE_FILE_LOG=true

# 監視設定
ERROR_RATE_THRESHOLD=10
ENABLE_WEBHOOK_NOTIFICATIONS=true
WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

## 🔄 ロールバック手順

問題が発生した場合、以下の手順で元に戻せます：

```bash
# バックアップから復元
cp auth.js.backup auth.js
cp config.js.backup config.js

# サーバーを再起動
npm start
```

## 📚 追加情報

### ログファイルの構造

```json
{
  "timestamp": "2024-10-27T12:34:56.789Z",
  "level": "ERROR",
  "category": "WEBAUTHN",
  "phase": "authentication",
  "userId": "user_123",
  "email": "u***r@example.com",
  "error": {
    "name": "NotAllowedError",
    "message": "The operation either timed out or was not allowed",
    "stack": "..."
  },
  "troubleshooting": [
    "ユーザーの認証操作時間が不足しています...",
    "..."
  ],
  "sessionId": "err_1698765432_abc123"
}
```

### エラー統計の確認

```bash
# 過去24時間のエラー統計
curl -H "Authorization: Bearer YOUR_SESSION_ID" \
     "http://localhost:3000/api/monitoring/status" | jq '.summary'

# 特定カテゴリのログ
curl -H "Authorization: Bearer YOUR_SESSION_ID" \
     "http://localhost:3000/api/monitoring/logs/webauthn-error?hours=24"
```

## 🆘 トラブルシューティング

### ログファイルが作成されない

1. `LOG_DIR` のパーミッションを確認
2. `ENABLE_FILE_LOG=true` が設定されているか確認
3. サーバーログでエラーがないか確認

### エラー監視が動作しない

1. `errorMonitor` が正しく初期化されているか確認
2. ログファイルが存在するか確認
3. `ERROR_RATE_THRESHOLD` の設定値を確認

### タイムアウトが適用されない

1. `.env` ファイルが正しく読み込まれているか確認
2. `auth` の初期化時に設定が渡されているか確認
3. サーバーログでタイムアウト値を確認

## ✅ チェックリスト

- [ ] 新規ファイルを配置
- [ ] 既存ファイルをバックアップ
- [ ] 強化版ファイルに置き換え
- [ ] `.env` に新しい設定を追加
- [ ] `server.js` を更新
- [ ] 依存関係をインストール
- [ ] サーバーを起動
- [ ] 設定表示を確認
- [ ] エラーログを確認
- [ ] 監視エンドポイントをテスト
- [ ] 本番環境の設定を確認

## 📞 サポート

問題が発生した場合は、以下の情報を確認してください：

1. サーバーログ
2. エラーログファイル（`logs/` ディレクトリ）
3. 環境変数の設定（`.env`）
4. `package.json` の依存関係

---

**重要**: 本番環境への適用前に、必ず開発環境またはステージング環境でテストしてください。
