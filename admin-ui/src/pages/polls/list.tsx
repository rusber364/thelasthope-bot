import { useQuery } from '@tanstack/react-query';
import { ClipboardList, ExternalLink, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import type { PollRow } from '@api';
import { PageHeader } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

export function PollListPage() {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['polls'], queryFn: () => api.get<PollRow[]>('/polls') });

  return (
    <>
      <PageHeader
        title="Опросы"
        description={
          <>
            Анкеты на несколько страниц с условиями — то же, что <code>/poll create</code>, только в браузере: написать, проверить,
            опубликовать и смотреть итоги.
          </>
        }
        actions={
          <Button render={<Link to="/polls/new" />} nativeButton={false}>
            <Plus /> Новый опрос
          </Button>
        }
      />
      {!data ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : data.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardList />
            </EmptyMedia>
            <EmptyTitle>Опросов пока нет</EmptyTitle>
            <EmptyDescription>Новый опрос откроется с шаблоном и подсказками.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link to="/polls/new" />} nativeButton={false}>
              <Plus /> Новый опрос
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Опрос</TableHead>
                  <TableHead>Канал</TableHead>
                  <TableHead>Ответы</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Создан</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((poll) => (
                  <TableRow key={poll.id} className="cursor-pointer" onClick={() => void navigate(`/polls/${poll.id}`)}>
                    <TableCell className="text-muted-foreground tabular-nums">{poll.id}</TableCell>
                    <TableCell className="font-medium">
                      <Link to={`/polls/${poll.id}`} className="hover:text-primary" onClick={(e) => e.stopPropagation()}>
                        {poll.title}
                      </Link>
                      {poll.onboarding && (
                        <Badge variant="outline" className="ml-2 border-primary/40 text-primary">
                          анкета новичков
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {poll.url ? (
                        <a
                          href={poll.url}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {poll.channel} <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">{poll.channel}</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {poll.completed}
                      {poll.total > poll.completed && (
                        <span className="text-xs text-muted-foreground"> +{poll.total - poll.completed} не закончили</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {poll.closed ? (
                        <Badge variant="secondary">закрыт</Badge>
                      ) : (
                        <Badge className="bg-success/15 text-success">открыт</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{formatDateTime(poll.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
