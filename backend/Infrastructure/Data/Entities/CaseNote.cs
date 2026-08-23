namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>协调员在案件里的内部备注，客人不可见。</summary>
public class CaseNote
{
    public Guid Id { get; set; }
    public Guid CaseId { get; set; }
    public Guid AuthorUserId { get; set; }
    public string Body { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }

    public Case? Case { get; set; }
    public User? Author { get; set; }
}
