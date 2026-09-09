using System.Text.Json;
using System.Text.Json.Serialization;

namespace TravelDisruptionAgent.Api.Features.Chat;

/// <summary>固定话术："可以在后台改"的最小实现：从 Config/chat-templates.json 读，改文件不用重新编译。</summary>
public class ChatTemplates
{
    // outOfScope/escalation/hotelAvailability 不再需要关键词表——路由判断改成 AI 在同一次生成里自判
    // (见 ChatService.BuildPromptAsync 的 OUT_OF_SCOPE/WANTS_HUMAN/HOTEL_QUESTION 三个自评标记)，
    // 这里只保留每种场景的固定话术文案，命中对应信号时套用。securityKeywords 是唯一还在用的关键词表，
    // 涉密/越权查询他人信息这条要在消息进 AI 之前就拦下来，见 ChatService.GenerateReplyAsync 的注释。
    [JsonPropertyName("outOfScopeTemplate")] public Dictionary<string, string> OutOfScopeTemplate { get; set; } = [];
    [JsonPropertyName("securityKeywords")] public List<string> SecurityKeywords { get; set; } = [];
    [JsonPropertyName("securityTemplate")] public Dictionary<string, string> SecurityTemplate { get; set; } = [];
    [JsonPropertyName("escalationTemplate")] public Dictionary<string, string> EscalationTemplate { get; set; } = [];
    [JsonPropertyName("hotelAvailabilityTemplate")] public Dictionary<string, string> HotelAvailabilityTemplate { get; set; } = [];

    public string Pick(Dictionary<string, string> byLanguage, string language) =>
        byLanguage.TryGetValue(language, out var v) ? v : byLanguage.GetValueOrDefault("en", "");

    public static ChatTemplates Load()
    {
        var path = Path.Combine(Directory.GetCurrentDirectory(), "Config", "chat-templates.json");
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<ChatTemplates>(json) ?? new ChatTemplates();
    }
}
