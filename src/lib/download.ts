/** Скачать вложение Discord (картинку, файл опроса) по ссылке. */
export async function download(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Не удалось скачать вложение: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
