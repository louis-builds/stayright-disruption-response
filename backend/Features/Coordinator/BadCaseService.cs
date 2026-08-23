using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Features.Chat;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class BadCaseService(IBadCaseRepository repo, GeminiClient gemini) : IBadCaseService
{
    public async Task<List<BadCaseListItemDto>> ListAsync(CancellationToken ct = default)
    {
        var messages = await repo.ListDislikedAsync(ct);
        return [.. messages.Select(m => new BadCaseListItemDto(
            m.Id, m.CaseId,
            m.Case?.Booking?.GuestUser?.Nickname ?? "",
            m.Case?.Disruption?.Title ?? "",
            m.Content.Length > 140 ? m.Content[..140] + "…" : m.Content,
            m.CreatedAt))];
    }

    public async Task<BadCaseReplayDto> ReplayAsync(Guid messageId, CancellationToken ct = default)
    {
        var message = await repo.FindMessageAsync(messageId, ct) ?? throw new CaseNotFoundException();
        var preceding = await repo.FindPrecedingGuestMessageAsync(message.CaseId, message.CreatedAt, ct);

        var analysis = await AnalyzeAsync(preceding?.Content, message.Content, ct);

        return new BadCaseReplayDto(message.Id, message.CaseId, preceding?.Content, message.Content, analysis);
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
}
