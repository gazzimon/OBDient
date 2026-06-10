import type { Config } from 'drizzle-kit';

export default {
  schema: './src/data/db/schema.ts',
  out: './src/data/db/migrations',
  dialect: 'sqlite',
  driver: 'expo',
} satisfies Config;
