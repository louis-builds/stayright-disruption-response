using System.Text.Json;
using System.Text.Json.Serialization;

namespace TravelDisruptionAgent.Api.Features.HotelPortal;

public record HotelRefundRules
{
    [JsonPropertyName("freeCancellationHours")]
    public int? FreeCancellationHours { get; set; }

    [JsonPropertyName("cancellationFeePercent")]
    public decimal? CancellationFeePercent { get; set; }

    [JsonPropertyName("cancellationFeeFixed")]
    public decimal? CancellationFeeFixed { get; set; }

    [JsonPropertyName("currency")]
    public string Currency { get; set; } = "NZD";
}

public static class RefundPolicyParser
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static HotelRefundRules? Parse(string? structuredRulesJson)
    {
        if (string.IsNullOrWhiteSpace(structuredRulesJson)) return null;
        try
        {
            return JsonSerializer.Deserialize<HotelRefundRules>(structuredRulesJson, JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static void Validate(string? structuredRulesJson)
    {
        if (string.IsNullOrWhiteSpace(structuredRulesJson)) return;
        var rules = Parse(structuredRulesJson)
            ?? throw new ArgumentException("Structured rules must be valid JSON.");
        if (rules.CancellationFeePercent is < 0 or > 100)
            throw new ArgumentException("cancellationFeePercent must be between 0 and 100.");
        if (rules.CancellationFeeFixed is < 0)
            throw new ArgumentException("cancellationFeeFixed must be non-negative.");
        if (rules.FreeCancellationHours is < 0)
            throw new ArgumentException("freeCancellationHours must be non-negative.");
    }

    public static (decimal Fee, decimal Refund) CalculateRefund(decimal totalAmount, HotelRefundRules? rules)
    {
        var feePercent = rules?.CancellationFeePercent ?? 10m;
        var feeFixed = rules?.CancellationFeeFixed ?? 0m;
        var fee = Math.Round(totalAmount * (feePercent / 100m) + feeFixed, 2);
        fee = Math.Min(fee, totalAmount);
        return (fee, totalAmount - fee);
    }
}
