export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// 跟后端分页协议(开发规范.md 1.3节)对齐,字段名固定,不得改成 items/rows/records。
export interface PagedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
