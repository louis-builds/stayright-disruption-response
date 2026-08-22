namespace TravelDisruptionAgent.Api.Infrastructure.Paging;

// data 内字段名固定为 list，不得用 items/rows/records（开发规范.md 1.3 节）。
public class PagedResult<T>
{
    public List<T> List { get; init; } = [];
    public int Total { get; init; }
    public int Page { get; init; }
    public int PageSize { get; init; }
    public int TotalPages { get; init; }

    public static PagedResult<T> Create(IReadOnlyList<T> items, int total, int page, int pageSize) =>
        new()
        {
            List = [.. items],
            Total = total,
            Page = page,
            PageSize = pageSize,
            TotalPages = pageSize <= 0 ? 0 : (int)Math.Ceiling(total / (double)pageSize),
        };
}
