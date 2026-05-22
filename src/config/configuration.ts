export interface AppConfig {
  databaseUrl: string;
  vaultDir: string;
  defaultParserVersion: string;
  jwtSecret: string;
  jwtExpiry: string;
  fileWatchInbox?: string;
  fileWatchArchive?: string;
  fileWatchIntervalSec?: string;
}

export default (): AppConfig => ({
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pension_ops',
  vaultDir: process.env.VAULT_DIR ?? './vault',
  defaultParserVersion: process.env.DEFAULT_PARSER_VERSION ?? '2024.1',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me-32chars-min!!',
  jwtExpiry: process.env.JWT_EXPIRY ?? '12h',
  fileWatchInbox: process.env.FILE_WATCH_INBOX_DIR,
  fileWatchArchive: process.env.FILE_WATCH_ARCHIVE_DIR,
  fileWatchIntervalSec: process.env.FILE_WATCH_INTERVAL_SEC,
});
