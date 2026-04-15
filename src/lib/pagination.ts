export interface PaginationMeta {
  hasMore: boolean;
  limit: number;
  offset: number;
  returned: number;
  total: number;
}

export function parseBoundedInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? `${fallback}`);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function paginateOffsetQuery<TItem>(
  items: TItem[],
  limit: number,
  offset = 0,
  total = items.length,
): {
  items: TItem[];
  pagination: PaginationMeta;
} {
  const pageItems = items.slice(0, limit);

  return {
    items: pageItems,
    pagination: {
      limit,
      offset,
      returned: pageItems.length,
      hasMore: total > offset + limit,
      total,
    },
  };
}

export function paginateWindow<TItem>(
  items: TItem[],
  limit: number,
  offset: number,
  total = items.length,
): {
  items: TItem[];
  pagination: PaginationMeta;
} {
  const pageItems = items.slice(offset, offset + limit);

  return {
    items: pageItems,
    pagination: {
      limit,
      offset,
      returned: pageItems.length,
      hasMore: total > offset + limit,
      total,
    },
  };
}
