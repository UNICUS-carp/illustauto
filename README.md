# IllustAuto - 改善された認証システムとエラーログ

## 概要

このプロジェクトは、WebAuthn認証システムに包括的なエラーログと監視機能を追加し、認証エラー（特にタイムアウトエラー）の根本的な解決を目指します。

## 主な改善点

### 1. 包括的なエラーログシステム (`utils/errorLogger.js`)

- **詳細なエラー追跡**: エラーの種類、操作、タイムスタンプ、ユーザー情報を記録
- **WebAuthn固有のエラー**: WebAuthn特有のエラーに対する詳細なログとトラブルシューティング
- **タイムアウトエラー**: タイムアウトの詳細な分析と推奨事項
- **ログローテーション**: 自動的にログファイルをローテーションして管理
- **統計情報**: エラーパターンと頻度の分析

### 2. 改善された認証サービス (`services/authService.js`)

- **設定可能なタイムアウト**: 登録と認証のタイムアウトを個別に設定可能
- **チャレンジ管理**: チャレンジの有効期限管理と自動クリーンアップ
- **エラーハンドリング**: すべての操作で包括的なエラーハンドリング
- **ユーザーフレンドリーなエラーメッセージ**: 技術的なエラーを日本語の分かりやすいメッセージに変換
- **リトライサポート**: エラーがリトライ可能かどうかを判定

### 3. エラー監視システム (`utils/errorMonitor.js`)

- **リアルタイム監視**: エラー率を定期的にチェック
- **パターン認識**: エラーパターンを自動的に識別
- **アラート機能**: 閾値を超えた場合にアラートを送信
- **Webhook通知**: Slackなどへのアラート通知（オプション）
- **統計ダッシュボード**: エラーサマリーとトレンド分析

### 4. 設定管理 (`config/auth.config.js`)

- **集中管理**: すべての設定を1箇所で管理
- **環境変数サポート**: `.env`ファイルで簡単に設定変更
- **本番環境対応**: 本番環境向けの推奨設定

## インストール

```bash
# 依存関係のインストール
npm install

# 環境変数の設定
cp .env.example .env
# .envファイルを編集して設定を調整
```

## 設定

### 重要な設定項目

#### タイムアウト設定

```env
# 登録タイムアウト（ミリ秒）
# 推奨: 120000-180000 (2-3分)
REGISTRATION_TIMEOUT=120000

# 認証タイムアウト（ミリ秒）
# 推奨: 90000-120000 (1.5-2分)
AUTHENTICATION_TIMEOUT=90000

# チャレンジ有効期限（ミリ秒）
# 推奨: 300000-600000 (5-10分)
CHALLENGE_EXPIRY=300000
```

#### ログ設定

```env
# ログディレクトリ
LOG_DIR=./logs

# コンソールログを有効化
ENABLE_CONSOLE_LOG=true

# ファイルログを有効化
ENABLE_FILE_LOG=true

# ログレベル (debug, info, warn, error)
LOG_LEVEL=info
```

#### 監視設定

```env
# 統計情報の収集を有効化
ENABLE_STATS=true

# エラー率の閾値（1時間あたりのエラー数）
ERROR_RATE_THRESHOLD=10

# Webhook通知を有効化
ENABLE_WEBHOOK_NOTIFICATIONS=false
WEBHOOK_URL=
```

## 使用方法

### サーバーの起動

```bash
# 本番環境
npm start

# 開発環境（自動再起動）
npm run dev
```

### API エンドポイント

#### 1. 登録フロー

**Step 1: 登録オプションの生成**

```http
POST /api/auth/register/options
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**レスポンス:**

```json
{
  "success": true,
  "options": {
    "challenge": "...",
    "rp": { "name": "IllustAuto", "id": "unicus.top" },
    "user": { "id": "...", "name": "user@example.com", "displayName": "user@example.com" },
    "timeout": 120000,
    ...
  },
  "metadata": {
    "timeout": 120000,
    "expiresAt": 1698765432100
  }
}
```

**Step 2: 登録レスポンスの検証**

```http
POST /api/auth/register/verify
Content-Type: application/json

{
  "userId": "user_...",
  "response": {
    "id": "...",
    "rawId": "...",
    "response": { ... },
    "type": "public-key"
  }
}
```

#### 2. 認証フロー

**Step 1: 認証オプションの生成**

```http
POST /api/auth/login/options
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Step 2: 認証レスポンスの検証**

```http
POST /api/auth/login/verify
Content-Type: application/json

{
  "email": "user@example.com",
  "response": {
    "id": "...",
    "rawId": "...",
    "response": { ... },
    "type": "public-key"
  }
}
```

#### 3. 監視ステータスの取得

```http
GET /api/monitoring/status
```

**レスポンス:**

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

## エラーログの構造

### 認証エラーログ (`logs/auth-error.log`)

```json
{
  "timestamp": "2024-10-27T12:34:56.789Z",
  "level": "ERROR",
  "category": "AUTHENTICATION",
  "operation": "verifyAuthentication",
  "userId": "user_123",
  "email": "u***r@example.com",
  "error": {
    "name": "Error",
    "message": "Challenge not found or expired",
    "code": "CHALLENGE_EXPIRED",
    "stack": "..."
  },
  "context": { ... },
  "sessionId": "err_1698765432_abc123"
}
```

### WebAuthnエラーログ (`logs/webauthn-error.log`)

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
  "webAuthnDetails": {
    "expectedChallenge": "1K3-8RUlmhwc8eAspLl...",
    "authenticatorType": "platform",
    ...
  },
  "troubleshooting": [
    "ユーザーの認証操作時間が不足しています。タイムアウトを延長してください。",
    "ユーザーが認証デバイス（指紋、顔認証など）の操作に慣れていない可能性があります。",
    "ネットワーク遅延が原因の可能性があります。"
  ],
  "sessionId": "err_1698765432_xyz789"
}
```

### タイムアウトエラーログ (`logs/timeout-error.log`)

```json
{
  "timestamp": "2024-10-27T12:34:56.789Z",
  "level": "ERROR",
  "category": "TIMEOUT",
  "operation": "verifyAuthentication",
  "userId": "user_123",
  "email": "u***r@example.com",
  "timing": {
    "configuredTimeout": 90000,
    "actualDuration": 135000,
    "exceededBy": 45000
  },
  "recommendations": [
    "タイムアウトを145秒以上に延長することを推奨します。",
    "ユーザーに十分な時間を提供するため、最低60秒のタイムアウトを設定してください。",
    "認証前にユーザーに明確な指示を表示してください。",
    "リトライメカニズムを実装してください。"
  ],
  "sessionId": "err_1698765432_def456"
}
```

## トラブルシューティング

### よくあるエラーと解決策

#### 1. タイムアウトエラー

**エラーメッセージ:**
```
The operation either timed out or was not allowed
```

**原因:**
- ユーザーが認証デバイスの操作に時間がかかっている
- ネットワーク遅延
- タイムアウト設定が短すぎる

**解決策:**
1. `.env`ファイルでタイムアウトを延長:
   ```env
   REGISTRATION_TIMEOUT=180000  # 3分
   AUTHENTICATION_TIMEOUT=120000  # 2分
   ```
2. ユーザーに明確な指示を表示
3. リトライオプションを提供

#### 2. チャレンジ期限切れエラー

**エラーメッセージ:**
```
Challenge not found or expired
```

**原因:**
- ユーザーが長時間待機してから操作を実行
- チャレンジの有効期限が短すぎる

**解決策:**
1. チャレンジの有効期限を延長:
   ```env
   CHALLENGE_EXPIRY=600000  # 10分
   ```
2. ユーザーにページを再読み込みしてもらう

#### 3. オリジンエラー

**エラーメッセージ:**
```
Origin verification failed
```

**原因:**
- `ORIGIN`と`ALLOWED_ORIGINS`の設定が正しくない
- HTTPSではなくHTTPで接続している

**解決策:**
1. `.env`ファイルでオリジンを確認:
   ```env
   ORIGIN=https://unicus.top
   ALLOWED_ORIGINS=https://unicus.top
   ```
2. HTTPSで接続していることを確認

### ログの確認方法

```bash
# 最新の認証エラーを確認
tail -f logs/auth-error.log

# 最新のWebAuthnエラーを確認
tail -f logs/webauthn-error.log

# 最新のタイムアウトエラーを確認
tail -f logs/timeout-error.log

# アラートログを確認
tail -f logs/alerts.log
```

## 監視とアラート

### エラー率の監視

システムは自動的にエラー率を監視し、閾値を超えた場合にアラートを送信します。

**設定:**
```env
# 1時間あたり10エラーを閾値とする
ERROR_RATE_THRESHOLD=10

# 5分ごとにチェック（デフォルト）
```

### Slack通知の設定

1. Slack Incoming Webhookを作成
2. `.env`ファイルに設定:
   ```env
   ENABLE_WEBHOOK_NOTIFICATIONS=true
   WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
   ```

## 本番環境での推奨設定

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
LOG_LEVEL=info

# セキュリティ設定
ALLOWED_ORIGINS=https://unicus.top
REQUIRE_USER_VERIFICATION=true

# 監視設定
ENABLE_STATS=true
ERROR_RATE_THRESHOLD=10
ENABLE_WEBHOOK_NOTIFICATIONS=true
WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# データベース設定
DATABASE_PATH=/var/lib/illustauto/illustauto.db
BACKUP_DIR=/var/backups/illustauto
```

## 開発とデバッグ

### デバッグモードの有効化

```env
LOG_LEVEL=debug
SHOW_DETAILED_ERRORS=true
```

### ログの詳細度を上げる

```env
ENABLE_CONSOLE_LOG=true
ENABLE_FILE_LOG=true
```

## アーキテクチャ

```
illustauto/
├── config/
│   └── auth.config.js          # 認証設定
├── services/
│   └── authService.js          # 認証サービス
├── utils/
│   ├── errorLogger.js          # エラーログ
│   └── errorMonitor.js         # エラー監視
├── logs/                       # ログディレクトリ
│   ├── auth-error.log
│   ├── webauthn-error.log
│   ├── timeout-error.log
│   ├── success.log
│   └── alerts.log
├── server.js                   # メインサーバー
├── package.json
├── .env.example
└── README.md
```

## セキュリティ考慮事項

1. **本番環境では詳細なエラーを表示しない**: `SHOW_DETAILED_ERRORS=false`
2. **HTTPSを必須とする**: すべての通信はHTTPSで行う
3. **ログファイルのアクセス権限**: ログファイルは適切なアクセス権限で保護
4. **メールアドレスのマスキング**: ログにはマスキングされたメールアドレスのみを記録
5. **定期的なログローテーション**: ログファイルが肥大化しないように管理

## パフォーマンス最適化

1. **チャレンジのクリーンアップ**: 期限切れチャレンジは自動的にクリーンアップ
2. **ログローテーション**: 大きなログファイルは自動的にローテーション
3. **非同期処理**: すべてのログ書き込みは非同期で実行

## ライセンス

ISC

## サポート

問題が発生した場合は、ログファイルを確認し、セッションIDを使用してエラーを追跡してください。

詳細なエラー情報は `/api/monitoring/status` エンドポイントで確認できます。
