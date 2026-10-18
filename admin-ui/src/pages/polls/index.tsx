import { Route, Routes, useSearchParams } from 'react-router';
import { NotFoundPage } from '@/pages/not-found';
import { PollEditorPage } from './editor';
import { PollListPage } from './list';
import { PollResultsPage } from './results';

/** Новый опрос и копия — разные черновики: при смене ?from= редактор начинается заново. */
function NewPoll() {
  const [params] = useSearchParams();
  return <PollEditorPage key={params.get('from') ?? 'new'} />;
}

/** Раздел «Опросы»: список, новый опрос (или копия: ?from=id) и итоги опроса. */
export function PollsSection() {
  return (
    <Routes>
      <Route index element={<PollListPage />} />
      <Route path="new" element={<NewPoll />} />
      <Route path=":id" element={<PollResultsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
