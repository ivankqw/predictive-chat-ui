export function formatIcsDate(date: string, time: string): string {
  const cleanDate = date.replaceAll('-', '').replaceAll('/', '');
  const cleanTime = time.replaceAll(':', '');
  const normalizedTime = cleanTime.length === 4 ? `${cleanTime}00` : cleanTime;
  return `${cleanDate}T${normalizedTime}`;
}
