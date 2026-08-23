import { useEffect, useState } from "react";
import "./Pagination.css";

const DEFAULT_PAGE_SIZE = 10;

/** 列表分页复用这一份：传全量数组进来，拿到当前页切片 + 一个 <Pagination> 控件。
 * items 变化(比如换了筛选条件)时自动把页码弹回第 1 页，避免停在一个已经不存在的页码上。 */
export function usePagination<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const pageSafe = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [items.length]);

  const paged = items.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  return { paged, page: pageSafe, setPage, totalPages };
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="pagination-bar">
      <button type="button" className="pagination-btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span className="pagination-label">Page {page} / {totalPages}</span>
      <button type="button" className="pagination-btn" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  );
}
