import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type Theme } from '@/lib/theme';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Переключатель темы: тёмная (по умолчанию), светлая или как в системе. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Тема оформления" />}>
        <Sun className="dark:hidden" />
        <Moon className="hidden dark:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup value={theme} onValueChange={(value: Theme) => setTheme(value)}>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Тёмная
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun /> Светлая
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> Как в системе
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
