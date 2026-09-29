namespace TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

/// <summary>status: draft|approved|rejected. One row per disliked AI message.
/// Admin writes an evaluation, Gemini drafts a Learned replies section, and only
/// Approve appends that section to the shared platform document.</summary>
public class BadCaseLearning
{
    public Guid Id { get; set; }
    public Guid MessageId { get; set; }
    public Guid EvaluatorUserId { get; set; }
    public string EvaluationNote { get; set; } = "";
    public string? DraftMarkdown { get; set; }
    public string Status { get; set; } = "draft";
    public Guid? ApprovedByUserId { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
    public Guid? RagDocumentId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Message? Message { get; set; }
    public User? Evaluator { get; set; }
    public RagDocument? RagDocument { get; set; }
}
