import { app } from './app';
import { env } from './config/env';
import { checkDatabaseConnection, closeDatabasePool } from './config/database';

const server = app.listen(env.PORT, async () => {
  console.log(`\n========================================`);
  console.log(`🚀 LedgerPro Server running on port ${env.PORT}`);
  console.log(`🌍 Environment: ${env.NODE_ENV}`);
  console.log(`📡 Health endpoint: http://localhost:${env.PORT}/api/v1/health`);
  console.log(`========================================\n`);

  const dbStatus = await checkDatabaseConnection();
  if (dbStatus.status === 'connected') {
    console.log(`✅ PostgreSQL connection established (Latency: ${dbStatus.latencyMs}ms)`);
  } else {
    console.error(`⚠️ PostgreSQL connection failed: ${dbStatus.error}`);
    console.error(`   Please check your DATABASE_URL in .env`);
  }
});

async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    console.log('HTTP server closed.');
    await closeDatabasePool();
    console.log('Database pool closed. Exiting process.');
    process.exit(0);
  });

  // Force close after 10 seconds if graceful shutdown takes too long
  setTimeout(() => {
    console.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default server;
