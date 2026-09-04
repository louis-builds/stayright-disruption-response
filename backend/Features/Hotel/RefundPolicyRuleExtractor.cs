using System.Text.Json;
using System.Text.RegularExpressions;
using TravelDisruptionAgent.Api.Features.Chat;

namespace TravelDisruptionAgent.Api.Features.HotelPortal;

/// <summary>把退款政策自由文本预填成结构化规则：先让 LLM 按固定 JSON 格式提取，
/// LLM 不可用或返回无法解析时退到本地正则兜底。两条路都只负责"预填候选值"——
/// 政策没提到的字段一律 null，由前端保留表单原值，绝不替酒店人员做决定。</summary>
public partial class RefundPolicyRuleExtractor(GeminiClient gemini, ILogger<RefundPolicyRuleExtractor> logger)
{
    private const string Prompt = """
        You are extracting structured refund rules from a hotel's cancellation policy.
        Return ONLY a JSON object with exactly these keys:
        - "freeCancellationHours": integer hours before check-in within which cancellation is free, or null if not stated
        - "cancellationFeePercent": number 0-100, the cancellation fee as a percentage of the total booking value, or null if not stated
        - "cancellationFeeFixed": number, the fixed cancellation fee amount, or null if not stated
        - "currency": 3-letter currency code, or null if not stated
        Rules: never guess; use null for anything the policy does not explicitly state.
        If the policy says cancellations are always free, use 0 for both fee fields.
        If the policy is non-refundable, use 100 for cancellationFeePercent.
        No markdown, no explanation, JSON only.

        Policy text:
        """;

    public async Task<ExtractedRefundRulesDto> ExtractAsync(string content, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(content))
            throw new ArgumentException("Policy content is empty; nothing to extract from.");

        var reply = await gemini.GenerateAsync(Prompt + content, ct);
        var fromLlm = TryParseRules(reply);
        if (fromLlm is not null)
        {
            Validate(fromLlm);
            return fromLlm with { AiUsed = true };
        }

        logger.LogWarning("LLM extraction unavailable or unparseable; falling back to regex prefill");
        var fallback = ExtractWithRegex(content);
        Validate(fallback);
        return fallback;
    }

    private static ExtractedRefundRulesDto? TryParseRules(string? reply)
    {
        if (string.IsNullOrWhiteSpace(reply)) return null;
        var text = reply.Trim();
        // 模型偶尔会用 ```json 围栏包一层，剥掉再解析
        if (text.StartsWith("```"))
        {
            var firstNewline = text.IndexOf('\n');
            var lastFence = text.LastIndexOf("```", StringComparison.Ordinal);
            if (firstNewline > 0 && lastFence > firstNewline)
                text = text[(firstNewline + 1)..lastFence].Trim();
        }
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            return new ExtractedRefundRulesDto(
                GetInt(root, "freeCancellationHours"),
                GetDecimal(root, "cancellationFeePercent"),
                GetDecimal(root, "cancellationFeeFixed"),
                GetString(root, "currency"),
                AiUsed: true);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static int? GetInt(JsonElement root, string name) =>
        root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var v) ? v : null;

    private static decimal? GetDecimal(JsonElement root, string name) =>
        root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number && el.TryGetDecimal(out var v) ? v : null;

    private static string? GetString(JsonElement root, string name) =>
        root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

    private static void Validate(ExtractedRefundRulesDto dto)
    {
        // 复用既有校验口径：把结果序列化回 JSON 走 RefundPolicyParser，避免两套规则漂移
        RefundPolicyParser.Validate(JsonSerializer.Serialize(new
        {
            freeCancellationHours = dto.FreeCancellationHours,
            cancellationFeePercent = dto.CancellationFeePercent,
            cancellationFeeFixed = dto.CancellationFeeFixed,
            currency = dto.Currency ?? "NZD",
        }));
    }

    private ExtractedRefundRulesDto ExtractWithRegex(string content)
    {
        int? hours = null;
        var hoursMatch = HoursPattern().Match(content);
        if (hoursMatch.Success && int.TryParse(hoursMatch.Groups[1].Value, out var h)) hours = h;

        decimal? percent = null;
        var percentMatch = PercentPattern().Match(content);
        if (percentMatch.Success && decimal.TryParse(percentMatch.Groups[1].Value, out var p)) percent = p;

        decimal? fixedFee = null;
        var fixedMatch = FixedFeePattern().Match(content);
        if (fixedMatch.Success && decimal.TryParse(fixedMatch.Groups[1].Value, out var f)) fixedFee = f;

        string? currency = CurrencyPattern().Match(content) is { Success: true } c ? c.Groups[1].Value.ToUpperInvariant() : null;

        if (content.Contains("non-refundable", StringComparison.OrdinalIgnoreCase)) percent ??= 100m;
        if (content.Contains("full refund", StringComparison.OrdinalIgnoreCase)
            && content.Contains("free cancellation", StringComparison.OrdinalIgnoreCase)
            && percent is null && fixedFee is null)
        {
            percent = 0m;
            fixedFee = 0m;
        }

        return new ExtractedRefundRulesDto(hours, percent, fixedFee, currency, AiUsed: false);
    }

    [GeneratedRegex(@"(\d{1,4})\s*(?:hours?|hrs?)\b", RegexOptions.IgnoreCase)]
    private static partial Regex HoursPattern();

    [GeneratedRegex(@"(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)\b", RegexOptions.IgnoreCase)]
    private static partial Regex PercentPattern();

    [GeneratedRegex(@"(?:NZD|AUD|USD|\$)\s*(\d+(?:\.\d+)?)", RegexOptions.IgnoreCase)]
    private static partial Regex FixedFeePattern();

    [GeneratedRegex(@"\b(NZD|AUD|USD|EUR|GBP)\b", RegexOptions.IgnoreCase)]
    private static partial Regex CurrencyPattern();
}
