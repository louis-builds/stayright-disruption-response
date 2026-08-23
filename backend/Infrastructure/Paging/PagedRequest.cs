namespace TravelDisruptionAgent.Api.Infrastructure.Paging;

// 开发规范.md 1.3 节分页协议，请求参数固定字段名，跨模块不得自行改名。
public class PagedRequest
{
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
    public string? SortBy { get; set; }
    public string SortOrder { get; set; } = "desc";
    public string? Keyword { get; set; }
}
