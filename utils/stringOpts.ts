export function truncate(str: string, limit: number): string {
    if (str.length >= limit) return str.slice(0, limit - 3) + '...';
    return str;
};