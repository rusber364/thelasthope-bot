// Резервная копия базы вручную: `pnpm backup`. Можно запускать и при работающем боте.
import { BACKUP_KEEP, backupDatabase } from '../lib/backup.ts';

const path = await backupDatabase();
console.log(`💾 Копия базы: ${path} (хранятся последние ${BACKUP_KEEP})`);
