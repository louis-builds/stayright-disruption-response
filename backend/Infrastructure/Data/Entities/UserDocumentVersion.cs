namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>指定某账号固定用某个文档版本，不设置时跟随该文档的默认版本。</summary>
public class UserDocumentVersion
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string DocumentName { get; set; } = "";
    public int Version { get; set; }
}
