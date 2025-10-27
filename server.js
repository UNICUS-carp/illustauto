/**
 * IllustAuto Backend Server with Improved Error Logging
 *
 * This server implements WebAuthn authentication with comprehensive error handling,
 * detailed logging, and monitoring capabilities.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const AuthService = require('./services/authService');
const ErrorMonitor = require('./utils/errorMonitor');
const authConfig = require('./config/auth.config');

const app = express();
const PORT = process.env.PORT || 8080;

// ========================================
// Configuration Validation
// ========================================
console.log('========================================');
console.log('🔧 Configuration Validation Results');
console.log('========================================');

const configIssues = {
  production: [],
  development: [],
};

// Validate production configuration
if (process.env.NODE_ENV === 'production') {
  if (!process.env.DATABASE_PATH) {
    configIssues.production.push('- DATABASE_PATH should be explicitly set in production');
  }
  if (!process.env.BACKUP_DIR) {
    configIssues.production.push('- BACKUP_DIR should be set in production for data safety');
  }
  if (!process.env.ALLOWED_ORIGINS) {
    configIssues.production.push('- ALLOWED_ORIGINS should be set in production');
  }
}

// Display configuration issues
if (configIssues.production.length > 0) {
  console.log('🔒 Production Issues:');
  configIssues.production.forEach(issue => console.log(issue));
}

if (configIssues.development.length > 0) {
  console.log('⚠️ Development Warnings:');
  configIssues.development.forEach(issue => console.log(issue));
}

if (configIssues.production.length === 0 && configIssues.development.length === 0) {
  console.log('✅ Configuration is valid for startup');
}

console.log('========================================');

// ========================================
// Initialize Services
// ========================================

// Initialize Authentication Service with error logging
const authService = new AuthService({
  rpName: authConfig.webauthn.rpName,
  rpID: authConfig.webauthn.rpID,
  origin: authConfig.webauthn.origin,
  registrationTimeout: authConfig.timeouts.registration,
  authenticationTimeout: authConfig.timeouts.authentication,
  challengeExpiry: authConfig.timeouts.challengeExpiry,
  maxRetries: authConfig.retry.maxRetries,
  retryDelay: authConfig.retry.retryDelay,
  logDir: authConfig.logging.logDir,
  enableConsoleLog: authConfig.logging.enableConsole,
  enableFileLog: authConfig.logging.enableFile,
});

console.log(`[auth] Initialized for ${authConfig.webauthn.rpID} (${process.env.NODE_ENV || 'development'})`);

// Initialize Error Monitor
const errorMonitor = new ErrorMonitor({
  enabled: authConfig.monitoring.enableStats,
  logDir: authConfig.logging.logDir,
  errorRateThreshold: authConfig.monitoring.errorRateThreshold,
  webhookUrl: authConfig.monitoring.webhookUrl,
  enableWebhookNotifications: authConfig.monitoring.enableWebhookNotifications,
});

console.log('[monitor] Error monitoring initialized');

// ========================================
// Database Initialization (placeholder)
// ========================================

// TODO: Initialize your database here
// For now, we'll use an in-memory store for demonstration
const users = new Map();
const credentials = new Map();

console.log('[db] Database initialized successfully');

// ========================================
// Middleware
// ========================================

app.use(express.json({
  limit: process.env.MAX_CONTENT_LENGTH
    ? `${process.env.MAX_CONTENT_LENGTH}kb`
    : '5mb',
}));

app.use(cors({
  origin: authConfig.security.allowedOrigins,
  credentials: true,
}));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[api] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// ========================================
// API Endpoints
// ========================================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * Get monitoring status and error statistics
 */
app.get('/api/monitoring/status', async (req, res) => {
  try {
    const [monitorStatus, errorSummary, authStats] = await Promise.all([
      Promise.resolve(errorMonitor.getStatus()),
      errorMonitor.getErrorSummary(24),
      authService.getErrorStatistics(24),
    ]);

    res.json({
      success: true,
      monitor: monitorStatus,
      summary: errorSummary,
      stats: authStats,
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
 * Generate registration options
 */
app.post('/api/auth/register/options', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required',
      });
    }

    // Check if user already exists
    let user = Array.from(users.values()).find(u => u.email === email);

    if (!user) {
      // Create new user
      const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      user = {
        id: userId,
        email,
        createdAt: new Date().toISOString(),
      };
      users.set(userId, user);
      console.log(`[auth] Created new user: ${userId}`);
    }

    const result = await authService.generateRegistrationOptions(email, user.id);

    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('[api] Registration options error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Verify registration response
 */
app.post('/api/auth/register/verify', async (req, res) => {
  try {
    const { userId, response } = req.body;
    const userAgent = req.headers['user-agent'];

    if (!userId || !response) {
      return res.status(400).json({
        success: false,
        error: 'userId and response are required',
      });
    }

    const user = users.get(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const result = await authService.verifyRegistration(userId, response, userAgent);

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Save credential
    const credentialId = result.verification.registrationInfo.credentialID.toString('base64');
    credentials.set(credentialId, {
      userId,
      credentialID: result.verification.registrationInfo.credentialID,
      credentialPublicKey: result.verification.registrationInfo.credentialPublicKey,
      counter: result.verification.registrationInfo.counter,
      transports: response.response?.transports || ['internal'],
      createdAt: new Date().toISOString(),
    });

    console.log(`[auth] Registration verified and saved for user ${userId}`);

    res.json({
      success: true,
      message: '登録が完了しました',
      duration: result.duration,
    });
  } catch (error) {
    console.error('[api] Registration verification error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Generate authentication options
 */
app.post('/api/auth/login/options', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required',
      });
    }

    // Find user
    const user = Array.from(users.values()).find(u => u.email === email);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found. Please register first.',
      });
    }

    // Find user's credentials
    const userCredentials = Array.from(credentials.values()).filter(c => c.userId === user.id);

    if (userCredentials.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No credentials found. Please register first.',
      });
    }

    const result = await authService.generateAuthenticationOptions(email, user.id, userCredentials);

    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('[api] Authentication options error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Verify authentication response
 */
app.post('/api/auth/login/verify', async (req, res) => {
  try {
    const { email, response } = req.body;
    const userAgent = req.headers['user-agent'];

    if (!email || !response) {
      return res.status(400).json({
        success: false,
        error: 'email and response are required',
      });
    }

    // Find user
    const user = Array.from(users.values()).find(u => u.email === email);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Find credential
    const credentialId = response.id;
    const credential = Array.from(credentials.values()).find(c =>
      c.credentialID.toString('base64') === credentialId ||
      c.credentialID.toString('base64url') === credentialId
    );

    if (!credential) {
      return res.status(404).json({
        success: false,
        error: 'Credential not found',
      });
    }

    const result = await authService.verifyAuthentication(
      user.id,
      email,
      response,
      credential,
      userAgent
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Update counter
    credential.counter = result.verification.authenticationInfo.newCounter;

    console.log(`[auth] Authentication verified for user ${user.id}`);

    res.json({
      success: true,
      message: 'ログインに成功しました',
      duration: result.duration,
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('[api] Authentication verification error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ========================================
// Error Handling
// ========================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);

  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// ========================================
// Start Server
// ========================================

const server = app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`📏 Max content length: ${process.env.MAX_CONTENT_LENGTH || 5000} characters`);
  console.log(`🔐 Origin: ${authConfig.webauthn.origin}`);
  console.log(`⏱️ Registration timeout: ${authConfig.timeouts.registration / 1000}s`);
  console.log(`⏱️ Authentication timeout: ${authConfig.timeouts.authentication / 1000}s`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('[server] Server closed');
    errorMonitor.stop();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[server] SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('[server] Server closed');
    errorMonitor.stop();
    process.exit(0);
  });
});

module.exports = app;
