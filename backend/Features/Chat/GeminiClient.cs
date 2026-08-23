using System.Text;
using System.Text.Json;

namespace TravelDisruptionAgent.Api.Features.Chat;

/// <summary>Gemini REST API 的最小封装：一个 HttpClient POST，不引 Google 的 SDK 包（用不上那么多功能）。</summary>
public class GeminiClient(IHttpClientFactory httpClientFactory, ILogger<GeminiClient> logger)
{
    public async Task<string?> GenerateAsync(string prompt, CancellationToken ct = default)
    {
        var apiKey = Environment.GetEnvironmentVariable("GEMINI_API_KEY");
        var model = Environment.GetEnvironmentVariable("GEMINI_MODEL") ?? "gemini-2.5-flash";
        if (string.IsNullOrEmpty(apiKey))
        {
            logger.LogWarning("GEMINI_API_KEY not configured; cannot generate AI reply");
            return null;
        }

        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}";
        // gemini-2.5-flash 默认会先"思考"再答，思考 token 也吃 maxOutputTokens 预算，
        // 短对话场景不需要，thinkingBudget=0 关掉，不然经常在思考阶段就把预算耗尽、正文被截断。
        var requestBody = new
        {
            contents = new[] { new { role = "user", parts = new[] { new { text = prompt } } } },
            generationConfig = new
            {
                temperature = 0.3,
                maxOutputTokens = 512,
                thinkingConfig = new { thinkingBudget = 0 },
            },
        };

        try
        {
            var client = httpClientFactory.CreateClient("gemini");
            using var response = await client.PostAsync(url,
                new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json"), ct);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Gemini API returned {Status}: {Body}", response.StatusCode, await response.Content.ReadAsStringAsync(ct));
                return null;
            }

            using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

            return doc.RootElement
                .GetProperty("candidates")[0]
                .GetProperty("content")
                .GetProperty("parts")[0]
                .GetProperty("text")
                .GetString();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Gemini call failed");
            return null;
        }
    }

    /// <summary>Gemini embedContent：把文本转成向量，供 RAG 检索算余弦相似度用。</summary>
    public async Task<float[]?> EmbedAsync(string text, CancellationToken ct = default)
    {
        var apiKey = Environment.GetEnvironmentVariable("GEMINI_API_KEY");
        if (string.IsNullOrEmpty(apiKey))
        {
            logger.LogWarning("GEMINI_API_KEY not configured; cannot generate embedding");
            return null;
        }

        var url = $"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={apiKey}";
        var requestBody = new { content = new { parts = new[] { new { text } } } };

        try
        {
            var client = httpClientFactory.CreateClient("gemini");
            using var response = await client.PostAsync(url,
                new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json"), ct);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Gemini embed API returned {Status}: {Body}", response.StatusCode, await response.Content.ReadAsStringAsync(ct));
                return null;
            }

            using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            return [.. doc.RootElement.GetProperty("embedding").GetProperty("values").EnumerateArray().Select(v => v.GetSingle())];
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Gemini embed call failed");
            return null;
        }
    }
}
