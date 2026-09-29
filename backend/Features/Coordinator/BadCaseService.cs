using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Features.Chat;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class BadCaseService(IBadCaseRepository repo, GeminiClient gemini, IKnowledgeBaseService kb) : IBadCaseService
{
    public async Task<List<BadCaseListItemDto>> ListAsync(CancellationToken ct = default)
    {
        var messages = await repo.ListDislikedAsync(ct);
        var learnings = await repo.ListLearningsByMessageIdsAsync(messages.Select(m => m.Id), ct);
        return [.. messages.Select(m => new BadCaseListItemDto(
            m.Id, m.CaseId,
            m.Case?.Booking?.GuestUser?.Nickname ?? "",
            m.Case?.Disruption?.Title ?? "",
            m.Content.Length > 140 ? m.Content[..140] + "…" : m.Content,
            m.CreatedAt, m.Escalated, m.MissedEscalationConfirmed,
            learnings.TryGetValue(m.Id, out var learning) ? learning.Status : null))];
    }

    public async Task ConfirmMissedEscalationAsync(Guid messageId, bool confirmed, CancellationToken ct = default)
    {
        var found = await repo.SetMissedEscalationConfirmedAsync(messageId, confirmed, ct);
        if (!found) throw new CaseNotFoundException();
    }

    public async Task<BadCaseReplayDto> ReplayAsync(Guid messageId, CancellationToken ct = default)
    {
        var message = await repo.FindMessageAsync(messageId, ct) ?? throw new CaseNotFoundException();
        var preceding = await repo.FindPrecedingGuestMessageAsync(message.CaseId, message.CreatedAt, ct);
        var analysis = await AnalyzeAsync(preceding?.Content, message.Content, ct);
        var learning = await repo.FindLearningByMessageIdAsync(messageId, ct);
        return new BadCaseReplayDto(
            message.Id, message.CaseId, preceding?.Content, message.Content, analysis, ToDto(learning));
    }

    public async Task<BadCaseThreadDto> GetThreadAsync(Guid messageId, CancellationToken ct = default)
    {
        var focus = await repo.FindMessageAsync(messageId, ct) ?? throw new CaseNotFoundException();
        var thread = await repo.ListAiThreadAsync(focus.CaseId, ct);
        var learnings = await repo.ListLearningsByMessageIdsAsync(thread.Select(m => m.Id), ct);
        return new BadCaseThreadDto(
            focus.CaseId, focus.Id,
            focus.Case?.Booking?.GuestUser?.Nickname ?? "",
            focus.Case?.Disruption?.Title ?? "",
            [.. thread.Select(m => new BadCaseThreadMessageDto(
                m.Id, m.SenderRole, m.Content, m.Vote, m.CreatedAt,
                learnings.TryGetValue(m.Id, out var learning) ? ToDto(learning) : null))]);
    }

    public async Task<BadCaseLearningDto> EvaluateAndDraftAsync(
        Guid messageId, Guid evaluatorUserId, string evaluationNote, CancellationToken ct = default)
    {
        var note = evaluationNote.Trim();
        if (note.Length == 0) throw new InvalidOperationException("Write a short evaluation first");

        var message = await RequireAiReplyAsync(messageId, ct);
        var preceding = await repo.FindPrecedingGuestMessageAsync(message.CaseId, message.CreatedAt, ct);
        var learning = await repo.FindLearningByMessageIdAsync(messageId, ct);
        if (learning?.Status == "approved")
            throw new InvalidOperationException("This reply has already been approved into Learned replies");

        var draft = await DraftSectionAsync(preceding?.Content, message.Content, note, ct);
        var now = DateTimeOffset.UtcNow;
        if (learning is null)
        {
            learning = new BadCaseLearning
            {
                Id = Guid.NewGuid(), MessageId = messageId, EvaluatorUserId = evaluatorUserId,
                EvaluationNote = note, DraftMarkdown = draft, Status = "draft",
                CreatedAt = now, UpdatedAt = now,
            };
            await repo.AddLearningAsync(learning, ct);
        }
        else
        {
            learning.EvaluatorUserId = evaluatorUserId;
            learning.EvaluationNote = note;
            learning.DraftMarkdown = draft;
            learning.Status = "draft";
            learning.UpdatedAt = now;
        }
        await repo.SaveChangesAsync(ct);
        return ToDto(learning)!;
    }

    public async Task<BadCaseLearningDto> SaveDraftAsync(Guid messageId, string draftMarkdown, CancellationToken ct = default)
    {
        var learning = await repo.FindLearningByMessageIdAsync(messageId, ct)
            ?? throw new CaseNotFoundException();
        if (learning.Status == "approved")
            throw new InvalidOperationException("This reply has already been approved into Learned replies");
        var draft = draftMarkdown.Trim();
        if (draft.Length == 0) throw new InvalidOperationException("Draft is empty");
        learning.DraftMarkdown = draft;
        learning.Status = "draft";
        learning.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
        return ToDto(learning)!;
    }

    public async Task<BadCaseLearningDto> ApproveAsync(
        Guid messageId, Guid approverUserId, string? draftMarkdown, CancellationToken ct = default)
    {
        var learning = await repo.FindLearningByMessageIdAsync(messageId, ct)
            ?? throw new CaseNotFoundException();
        if (learning.Status == "approved")
            throw new InvalidOperationException("This reply has already been approved into Learned replies");

        if (!string.IsNullOrWhiteSpace(draftMarkdown))
            learning.DraftMarkdown = draftMarkdown.Trim();
        if (string.IsNullOrWhiteSpace(learning.DraftMarkdown))
            throw new InvalidOperationException("Generate a knowledge draft before approving");

        var doc = await kb.AppendLearnedReplyAsync(learning.DraftMarkdown, ct);
        var now = DateTimeOffset.UtcNow;
        learning.Status = "approved";
        learning.ApprovedByUserId = approverUserId;
        learning.ApprovedAt = now;
        learning.RagDocumentId = doc.Id;
        learning.UpdatedAt = now;
        await repo.SaveChangesAsync(ct);
        return ToDto(learning, doc.Version)!;
    }

    public async Task<BadCaseLearningDto> RejectAsync(Guid messageId, Guid evaluatorUserId, CancellationToken ct = default)
    {
        var learning = await repo.FindLearningByMessageIdAsync(messageId, ct)
            ?? throw new CaseNotFoundException();
        if (learning.Status == "approved")
            throw new InvalidOperationException("This reply has already been approved into Learned replies");
        learning.Status = "rejected";
        learning.EvaluatorUserId = evaluatorUserId;
        learning.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
        return ToDto(learning)!;
    }

    private async Task<Message> RequireAiReplyAsync(Guid messageId, CancellationToken ct)
    {
        var message = await repo.FindMessageAsync(messageId, ct) ?? throw new CaseNotFoundException();
        if (message.SenderRole != "ai")
            throw new InvalidOperationException("Only AI replies can become Learned replies");
        return message;
    }

    private async Task<string> AnalyzeAsync(string? question, string reply, CancellationToken ct)
    {
        var prompt =
            "You are reviewing a customer-service AI reply that a guest disliked (thumbs-down), for a travel disruption support tool.\n" +
            $"Guest's question (may be missing): {question ?? "(not available)"}\n" +
            $"AI's reply that was disliked: {reply}\n\n" +
            "In 2-3 short sentences, give a structured analysis of the likely reason the guest disliked this reply " +
            "(e.g. answer was off-topic, too vague, missed the actual question, tone issue, factually wrong, unhelpful refusal). " +
            "Do not just repeat or summarize the reply — diagnose the failure mode.";

        var result = await gemini.GenerateAsync(prompt, ct);
        return result ?? "AI analysis unavailable right now (Gemini not configured or request failed) — review the exchange above manually.";
    }

    private async Task<string> DraftSectionAsync(string? question, string reply, string evaluation, CancellationToken ct)
    {
        var prompt =
            "You write one reusable knowledge section for a travel-disruption support assistant.\n" +
            "This goes into a shared document called Learned replies. The assistant will retrieve it later.\n\n" +
            $"Admin evaluation (what was wrong and how it should have been answered):\n{evaluation}\n\n" +
            $"Guest's question: {question ?? "(not available)"}\n" +
            $"AI reply that was disliked: {reply}\n\n" +
            "Output ONLY markdown for one section:\n" +
            "## {short heading in English}\n" +
            "Then 2-4 sentences of instruction the assistant should follow next time this situation appears.\n\n" +
            "Rules:\n" +
            "- Generalize. No guest names, confirmation numbers, or specific stay dates.\n" +
            "- Do not invent refund rates or hotel inventory.\n" +
            "- If the failure was answering a rebooking question without offering recovery options, the section must tell the assistant to point the guest to the case recovery options (defer / alternate hotel / cancel) instead of only saying the platform has no public booking.\n" +
            "- No preamble, no code fences.";

        var result = await gemini.GenerateAsync(prompt, ct);
        if (string.IsNullOrWhiteSpace(result))
            throw new InvalidOperationException("Could not generate a knowledge draft right now");
        return result.Trim();
    }

    private static BadCaseLearningDto? ToDto(BadCaseLearning? learning, int? version = null) =>
        learning is null ? null : new BadCaseLearningDto(
            learning.Status, learning.EvaluationNote, learning.DraftMarkdown, learning.ApprovedAt, version);
}
