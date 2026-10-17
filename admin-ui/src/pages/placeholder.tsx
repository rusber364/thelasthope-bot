import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/page';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import type { NavItem } from '@/nav';

/** Раздел, который ещё переносится в новую админку. */
export function PlaceholderPage({ item }: { item: NavItem }) {
  return (
    <>
      <PageHeader title={item.title} description={item.description} />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Construction />
          </EmptyMedia>
          <EmptyTitle>Раздел переносится</EmptyTitle>
          <EmptyDescription>Скоро здесь будут настройки этого раздела.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </>
  );
}
