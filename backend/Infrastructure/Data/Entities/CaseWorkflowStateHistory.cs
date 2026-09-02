namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>Audit interval for a case's derived workflow state.</summary>
public class CaseWorkflowStateHistory
{
    public Guid Id { get; set; }
    public Guid CaseId { get; set; }
    public string State { get; set; } = "new";
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }

    public Case? Case { get; set; }
}
