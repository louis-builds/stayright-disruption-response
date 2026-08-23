using System.Text.Json;
using System.Text.Json.Serialization;

namespace TravelDisruptionAgent.Api.Features.Chat;

/// <summary>固定话术："可以在后台改"的最小实现：从 Config/chat-templates.json 读，改文件不用重新编译。</summary>
public class ChatTemplates
{
    [JsonPropertyName("outOfScopeKeywords")] public List<string> OutOfScopeKeywords { get; set; } = [];
    [JsonPropertyName("outOfScopeTemplate")] public Dictionary<string, string> OutOfScopeTemplate { get; set; } = [];
    [JsonPropertyName("securityKeywords")] public List<string> SecurityKeywords { get; set; } = [];
    [JsonPropertyName("securityTemplate")] public Dictionary<string, string> SecurityTemplate { get; set; } = [];
    [JsonPropertyName("escalationKeywords")] public List<string> EscalationKeywords { get; set; } = [];
    [JsonPropertyName("escalationTemplate")] public Dictionary<string, string> EscalationTemplate { get; set; } = [];
    [JsonPropertyName("hotelAvailabilityKeywords")] public List<string> HotelAvailabilityKeywords { get; set; } = [];
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
