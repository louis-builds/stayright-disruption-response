namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>案件分派/转交审计：action: assign|transfer。</summary>
public class CaseAssignment
{
    public Guid Id { get; set; }
    public Guid CaseId { get; set; }
    public Guid ActorUserId { get; set; }
    public Guid? FromCoordinatorId { get; set; }
    public Guid ToCoordinatorId { get; set; }
    public string Action { get; set; } = "assign";
    public DateTimeOffset CreatedAt { get; set; }

    public Case? Case { get; set; }
}
