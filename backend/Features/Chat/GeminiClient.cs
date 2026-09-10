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

    public record AlternateRequestIntent(bool WantsAlternate, string? Criterion);

    /// <summary>用 Gemini responseSchema 判断客人这句话是不是在要求换一个候补方案，以及图什么
    /// (更便宜/更近/房间更大/说不清)——不用关键词硬判，客人可能说"离市区近点"/"房间大点"，
    /// 不是只有"cheap"这一种问法。criterion 只在 wants_alternate=true 时有意义。
    /// 只走 Gemini，不降级 Bedrock：拿不到就当这轮没有换方案的请求，不阻断正常回复。</summary>
    public async Task<AlternateRequestIntent?> ClassifyAlternateRequestAsync(string guestMessage, CancellationToken ct = default)
    {
        var apiKey = Environment.GetEnvironmentVariable("GEMINI_API_KEY");
        var model = Environment.GetEnvironmentVariable("GEMINI_MODEL") ?? "gemini-2.5-flash";
        if (string.IsNullOrEmpty(apiKey)) return null;

        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}";
        var prompt = $"A hotel guest sent this message in a support chat: \"{guestMessage}\"\nIs the guest asking to switch to a different alternate hotel/room option, for any reason (cheaper, closer to the original hotel, a bigger room, or anything else)? If yes, what's the main criterion they care about: \"cheaper\", \"closer\", \"larger\", or \"other\" if unclear or some other reason. Answer only based on what's given.";
        var requestBody = new
        {
            contents = new[] { new { role = "user", parts = new[] { new { text = prompt } } } },
            generationConfig = new
            {
                temperature = 0.0,
                maxOutputTokens = 50,
                thinkingConfig = new { thinkingBudget = 0 },
                responseMimeType = "application/json",
                responseSchema = new
                {
                    type = "OBJECT",
                    properties = new
                    {
                        wants_alternate = new { type = "BOOLEAN" },
                        criterion = new { type = "STRING", @enum = new[] { "cheaper", "closer", "larger", "other" } },
                    },
                    required = new[] { "wants_alternate" },
                },
            },
        };

        try
        {
            var client = httpClientFactory.CreateClient("gemini");
            using var response = await client.PostAsync(url,
                new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json"), ct);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Gemini alternate-request classification returned {Status}: {Body}",
                    response.StatusCode, await response.Content.ReadAsStringAsync(ct));
                return null;
            }

            using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var text = doc.RootElement.GetProperty("candidates")[0].GetProperty("content")
                .GetProperty("parts")[0].GetProperty("text").GetString();
            if (text is null) return null;

            using var parsed = JsonDocument.Parse(text);
            var root = parsed.RootElement;
            var wantsAlternate = root.GetProperty("wants_alternate").GetBoolean();
            var criterion = root.TryGetProperty("criterion", out var c) ? c.GetString() : null;
            return new AlternateRequestIntent(wantsAlternate, criterion);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Gemini alternate-request classification failed");
            return null;
        }
    }

    /// <summary>用 Gemini responseSchema 强制返回结构化布尔值，判断客人是不是在确认要一个刚推荐的
    /// 候补方案——不用正则抠自由文本，遵循项目对"新增结构化输出需求"的约定。
    /// 只走 Gemini，不降级 Bedrock：这是锦上添花的自动化判断，拿不到就跳过这次自动重算，
    /// 不阻断本轮对话的正常回复。</summary>
    public async Task<bool?> ClassifyConfirmsAlternativeSwitchAsync(string previousAiMessage, string guestMessage, CancellationToken ct = default)
    {
        var apiKey = Environment.GetEnvironmentVariable("GEMINI_API_KEY");
        var model = Environment.GetEnvironmentVariable("GEMINI_MODEL") ?? "gemini-2.5-flash";
        if (string.IsNullOrEmpty(apiKey)) return null;

        var url = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}";
        var prompt = $"An assistant recommended a specific alternate hotel option to a guest: \"{previousAiMessage}\"\nThe guest then replied: \"{guestMessage}\"\nDoes the guest's reply confirm they want to switch to that alternate option? Answer only based on what's given.";
        var requestBody = new
        {
            contents = new[] { new { role = "user", parts = new[] { new { text = prompt } } } },
            generationConfig = new
            {
                temperature = 0.0,
                maxOutputTokens = 50,
                thinkingConfig = new { thinkingBudget = 0 },
                responseMimeType = "application/json",
                responseSchema = new
                {
                    type = "OBJECT",
                    properties = new { confirms = new { type = "BOOLEAN" } },
                    required = new[] { "confirms" },
                },
            },
        };

        try
        {
            var client = httpClientFactory.CreateClient("gemini");
            using var response = await client.PostAsync(url,
                new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json"), ct);

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("Gemini alternate-switch confirmation classification returned {Status}: {Body}",
                    response.StatusCode, await response.Content.ReadAsStringAsync(ct));
                return null;
            }

            using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var text = doc.RootElement.GetProperty("candidates")[0].GetProperty("content")
                .GetProperty("parts")[0].GetProperty("text").GetString();
            if (text is null) return null;

            using var parsed = JsonDocument.Parse(text);
            return parsed.RootElement.GetProperty("confirms").GetBoolean();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Gemini alternate-switch confirmation classification failed");
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
