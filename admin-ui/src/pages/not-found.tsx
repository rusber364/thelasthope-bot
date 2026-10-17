import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

export function NotFoundPage() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Compass />
        </EmptyMedia>
        <EmptyTitle>Такой страницы нет</EmptyTitle>
        <EmptyDescription>Возможно, ссылка устарела. Выбери раздел в меню слева.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/" />} nativeButton={false} variant="outline">
          На главную
        </Button>
      </EmptyContent>
    </Empty>
  );
}
