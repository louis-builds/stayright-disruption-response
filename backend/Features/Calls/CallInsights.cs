using System.Text.Json.Serialization;

namespace TravelDisruptionAgent.Api.Features.Calls;

public record CallInsightFlag(bool Suggested, string? Quote);

public record CallStayInsight(string? Suggested, string? Quote);

public record CallInsights(CallInsightFlag KeepMessagesSimple, CallInsightFlag SpeakSlowly, CallStayInsight StayPreference)
{
    public static CallInsights Empty { get; } = new(new(false, null), new(false, null), new(null, null));
}

public record CallInsightFlagDto(bool Suggested, string? Quote, bool Applied);

public record CallStayInsightDto(string? Suggested, string? Quote, string? Applied);

public record CallInsightsDto(CallInsightFlagDto KeepMessagesSimple, CallInsightFlagDto SpeakSlowly, CallStayInsightDto StayPreference);

public record ConfirmCallInsightsRequest(bool KeepMessagesSimple, bool SpeakSlowly, string? StayPreference);

internal sealed class CallInsightsPayload
{
    [JsonPropertyName("keepMessagesSimple")] public CallInsightFlag KeepMessagesSimple { get; init; } = new(false, null);
    [JsonPropertyName("speakSlowly")] public CallInsightFlag SpeakSlowly { get; init; } = new(false, null);
    [JsonPropertyName("stayPreference")] public CallStayInsight StayPreference { get; init; } = new(null, null);
}
