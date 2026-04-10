// Quebec timezone utilities — always use these instead of manual calculations
export function getQuebecNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
}

export function getQuebecHour(): number {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto', hour: 'numeric', hour12: false }));
}

export function getQuebecDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

export function getQuebecDay(): number {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' })).getDay();
}

export function getQuebecDayOfMonth(): number {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' })).getDate();
}

export function isBusinessHours(): boolean {
  const hour = getQuebecHour();
  return hour >= 8 && hour < 21;
}

export function formatQuebecDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('fr-CA', { timeZone: 'America/Toronto', year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatQuebecTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString('fr-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });
}
