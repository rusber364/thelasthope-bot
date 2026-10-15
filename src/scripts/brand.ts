// Ставит аватар и баннер бота из картинок проекта: `pnpm brand` (или `pnpm brand avatar` / `pnpm brand banner`).
import { REST } from 'discord.js';
import { config } from '../config.ts';
import { applyBranding, brandingError, brandingFile, type BrandingPart } from '../lib/branding.ts';

const requested = process.argv[2];
const parts: BrandingPart[] = requested === 'avatar' || requested === 'banner' ? [requested] : ['avatar', 'banner'];
const rest = new REST().setToken(config.token);

let failed = false;
for (const part of parts) {
  try {
    const user = await applyBranding(rest, part);
    const hash = part === 'avatar' ? user.avatar : user.banner;
    console.log(`✅ ${part === 'avatar' ? 'Аватар' : 'Баннер'} обновлён из ${brandingFile(part)} (hash: ${hash ?? 'нет'})`);
  } catch (error) {
    failed = true;
    console.error(`❌ ${part === 'avatar' ? 'Аватар' : 'Баннер'}: ${brandingError(error)}`);
  }
}
process.exit(failed ? 1 : 0);
