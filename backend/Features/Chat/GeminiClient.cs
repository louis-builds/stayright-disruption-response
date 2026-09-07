using System.Text;
using System.Text.Json;
using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;
using TravelDisruptionAgent.Api.Infrastructure.Data;

namespace TravelDisruptionAgent.Api.Features.Chat;

/// <summary>LLM 生成的最小封装：首选 Gemini REST API（不引 Google SDK），Gemini 未配置或调用失败时
/// 降级到 AWS Bedrock Converse（凭证走 EC2 实例角色，模型 ID 由 env BEDROCK_MODEL_ID 注入，
/// 值即 SSM /stayright/dev/BEDROCK_MODEL_ID）。两条路都失败才返回 null 交给上层降级文案。</summary>
public class GeminiClient(IHttpClientFactory httpClientFactory, ILogger<GeminiClient> logger)
{
    // GeminiClient 是 scoped，Bedrock 客户端做成进程级单例避免每次请求重建
    private static readonly Lazy<IAmazonBedrockRuntime> Bedrock = new(() =>
        new AmazonBedrockRuntimeClient(new AmazonBedrockRuntimeConfig
        {
            RegionEndpoint = Amazon.RegionEndpoint.APSoutheast2,
            Timeout = TimeSpan.FromSeconds(60),
        }));

    public async Task<string?> GenerateAsync(string prompt, CancellationToken ct = default)
    {
        var reply = await GenerateViaGeminiAsync(prompt, ct);
        reply ??= await GenerateViaBedrockAsync(prompt, ct);
        return reply;
    }

    private async Task<string?> GenerateViaGeminiAsync(string prompt, CancellationToken ct)
    {
        var apiKey = Environment.GetEnvironmentVariable("GEMINI_API_KEY");
        var model = Environment.GetEnvironmentVariable("GEMINI_MODEL") ?? "gemini-2.5-flash";
        if (string.IsNullOrEmpty(apiKey))
        {
            logger.LogWarning("GEMINI_API_KEY not configured; trying Bedrock fallback");
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
                logger.LogWarning("Gemini API returned {Status}: {Body}; trying Bedrock fallback",
                    response.StatusCode, await response.Content.ReadAsStringAsync(ct));
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
            logger.LogWarning(ex, "Gemini call failed; trying Bedrock fallback");
            return null;
        }
    }

    private async Task<string?> GenerateViaBedrockAsync(string prompt, CancellationToken ct)
    {
        var modelId = Environment.GetEnvironmentVariable("BEDROCK_MODEL_ID");
        if (string.IsNullOrEmpty(modelId))
        {
            logger.LogWarning("BEDROCK_MODEL_ID not configured either; no LLM available");
            return null;
        }

        try
        {
            var response = await Bedrock.Value.ConverseAsync(new ConverseRequest
            {
                ModelId = modelId,
                Messages =
                [
                    new() { Role = ConversationRole.User, Content = [new() { Text = prompt }] },
                ],
                InferenceConfig = new() { Temperature = 0.3f, MaxTokens = 512 },
            }, ct);
            var text = response.Output?.Message?.Content?.FirstOrDefault(b => !string.IsNullOrEmpty(b.Text))?.Text;
            if (text is not null) logger.LogInformation("AI reply generated via Bedrock {Model}", modelId);
            return text;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Bedrock fallback failed for model {Model}", modelId);
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
        var requestBody = new
        {
            content = new { parts = new[] { new { text } } },
            outputDimensionality = EmbeddingVector.Dimensions,
        };

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
            var values = doc.RootElement.GetProperty("embedding").GetProperty("values")
                .EnumerateArray().Select(v => v.GetSingle()).ToArray();
            if (values.Length > EmbeddingVector.Dimensions)
                values = values[..EmbeddingVector.Dimensions];
            if (values.Length != EmbeddingVector.Dimensions)
            {
                logger.LogWarning("Gemini embedding size {Length} != {Expected}", values.Length, EmbeddingVector.Dimensions);
                return null;
            }
            return values;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Gemini embed call failed");
            return null;
        }
    }
}
