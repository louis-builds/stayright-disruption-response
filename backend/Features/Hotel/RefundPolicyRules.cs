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

    // checkIn/now 由调用方传入，不在这个纯计算函数里读当前时间——之前这里完全没看 FreeCancellationHours，
    // 不管客人是提前一个月还是临出发前取消都无脑按 CancellationFeePercent 扣，退款金额算错了。
    // 现在：政策写了免费取消小时数、且当前时间到入住还够这个窗口，才是全额退款；
    // 没写 FreeCancellationHours(rules 里没这个字段)时保留旧行为，不做时间判断，直接按百分比扣——
    // 这跟"酒店没具体说免费窗口是多久"时该怎么算是两回事，不能因为加了时间判断就把这种情况也堵死。
    public static (decimal Fee, decimal Refund) CalculateRefund(decimal totalAmount, HotelRefundRules? rules, DateOnly checkIn, DateTimeOffset now)
    {
        if (rules?.FreeCancellationHours is { } freeHours)
        {
            var hoursUntilCheckIn = (checkIn.ToDateTime(TimeOnly.MinValue) - now.UtcDateTime).TotalHours;
            if (hoursUntilCheckIn >= freeHours) return (0m, totalAmount);
        }

        var feePercent = rules?.CancellationFeePercent ?? 10m;
        var feeFixed = rules?.CancellationFeeFixed ?? 0m;
        var fee = Math.Round(totalAmount * (feePercent / 100m) + feeFixed, 2);
        fee = Math.Min(fee, totalAmount);
        return (fee, totalAmount - fee);
    }
}
