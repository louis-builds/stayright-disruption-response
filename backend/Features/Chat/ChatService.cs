using System.Text;
using TravelDisruptionAgent.Api.Features.Coordinator;
using TravelDisruptionAgent.Api.Features.HotelPortal;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.Chat;

public record ChatReply(string Content, bool Escalate, bool IsTemplate, bool NeedsHotelInquiry = false, string? EscalationReason = null, string? EscalationTrigger = null);

public interface IChatService
{
    Task<ChatReply> GenerateReplyAsync(Case caseEntity, List<Message> recentMessages, string userMessage, string language, CancellationToken ct = default);
    string BuildProactiveOpening(Case caseEntity, bool hotelConfirmed, string language, bool isReturningGuest = false);
}

public class ChatService(GeminiClient gemini, IRagRepository ragRepository, ISystemSettingsRepository settingsRepo, IHotelRepository hotelRepo, ILogger<ChatService> logger) : IChatService
{
    private static readonly ChatTemplates Templates = ChatTemplates.Load();

    // 跟 CoordinatorService.EscalationFilterMap / 前端 escalationLabels.ts 是同一份中文短语，
    // 决定这个案件会不会出现在协调员的 Escalation queue 页签、显示哪个原因标签，不能随便改字面值。
    private const string ReasonAiStuck = "AI搞不定";
    private const string ReasonLowConfidence = "AI没把握";
    private const string ReasonFrustrated = "客人情绪激动";

    private static bool ContainsAny(string text, IEnumerable<string> keywords) =>
        keywords.Any(k => text.Contains(k, StringComparison.OrdinalIgnoreCase));

    public string BuildProactiveOpening(Case caseEntity, bool hotelConfirmed, string language, bool isReturningGuest = false)
    {
        var disruption = caseEntity.Disruption?.Title ?? "a disruption";
        var hotel = caseEntity.Booking?.Hotel?.Name ?? "your hotel";
        // 客人名下可能不止一单——不点名是哪个确认号，光说"your booking"分不清是哪一条。
        var confirmationSuffix = caseEntity.Booking?.ConfirmationNo is { } confNo ? $" ({confNo})" : "";
        var status = hotelConfirmed
            ? "The hotel has confirmed availability, so you can pick an option right away."
            : "We're waiting for the hotel to confirm availability — you can still pick an option, but it may take a little longer.";
        // 认出回头客(在这家酒店住过≥2次)只是加一句寒暄，不影响任何判断逻辑——纯粹让开场白显得
        // 没那么机械。用 HotelRepository.GetReturningGuestIdsAsync 同一套"这家酒店的回头客"口径。
        var returningGuestClause = isReturningGuest
            ? (language == "zh" ? "您是我们的老客户了，" : "since you've stayed with us before, ")
            : "";

        // 跟 HotelService.ToDto / DisruptionService.NotifyCandidatesAsync 同一套规则(比原定入住
        // 日期晚3天、保持原住宿晚数)——客人打开对话第一眼看到的这句话之前完全没提具体日期，
        // 只说"我们在等酒店确认"，客人不知道到底会改到几号，也不知道能提别的日期。
        string? deferHint = null;
        if (caseEntity.Booking is { } booking)
        {
            var nights = Math.Max(booking.CheckOut.DayNumber - booking.CheckIn.DayNumber, 1);
            var proposedCheckIn = booking.CheckIn.AddDays(3);
            var proposedCheckOut = proposedCheckIn.AddDays(nights);
            deferHint = language == "zh"
                ? $"如果选延期方案，预计会改到 {proposedCheckIn:yyyy-MM-dd} → {proposedCheckOut:yyyy-MM-dd}（预估，不满意可以在这里告诉我们别的日期）。"
                : $"If you go with the deferral option, it's expected to move your stay to {proposedCheckIn:yyyy-MM-dd} → {proposedCheckOut:yyyy-MM-dd} (estimated — let us know here if you'd prefer different dates).";
        }

        return language switch
        {
            "zh" => $"您好，{returningGuestClause}由于{disruption}，您在{hotel}的预订{confirmationSuffix}可能受到影响。{(hotelConfirmed ? "酒店已确认可以安排，您可以直接选择方案。" : "我们正在等待酒店确认，您也可以先选一个方案，稍后会告知结果。")}{(deferHint is null ? "" : " " + deferHint)}",
            _ => $"Hi, {returningGuestClause}due to {disruption}, your booking at {hotel}{confirmationSuffix} may be affected. {status}{(deferHint is null ? "" : " " + deferHint)}",
        };
    }

    public async Task<ChatReply> GenerateReplyAsync(Case caseEntity, List<Message> recentMessages, string userMessage, string language, CancellationToken ct = default)
    {
        var settings = await settingsRepo.GetAsync(ct);

        // 安全专家优先级最高：涉密码/越权查询他人信息，直接拒答，不进 AI。
        if (ContainsAny(userMessage, Templates.SecurityKeywords))
            return new ChatReply(Templates.Pick(Templates.SecurityTemplate, language), false, true);

        // 客人明确要求转人工，或情绪化/争议关键词：直接转人工，不进 AI。
        if (ContainsAny(userMessage, Templates.EscalationKeywords))
            return new ChatReply(Templates.Pick(Templates.EscalationTemplate, language), true, true, EscalationReason: ReasonAiStuck, EscalationTrigger: "escalation_keyword");

        // 只有酒店能核实的事(空房/延期/升房)：这不是"AI答不上来该转人工"，是有明确、确定性的下一步
        // (给酒店落一条待办)，不该走"转协调员"话术——协调员这时候压根不用管，用户反馈过这里之前
        // 误用了转人工模板，误导客人去点协调员 tab。独立分支、独立话术，NeedsHotelInquiry=true 让
        // CaseService 去建 Inquiry，但 Escalate 留 false，不通知协调员、不标记 Message.Escalated。
        if (ContainsAny(userMessage, Templates.HotelAvailabilityKeywords))
            return new ChatReply(Templates.Pick(Templates.HotelAvailabilityTemplate, language), false, true, true);

        // 超出服务范围的问题：不硬编模型回答，走固定话术。
        if (ContainsAny(userMessage, Templates.OutOfScopeKeywords))
            return new ChatReply(Templates.Pick(Templates.OutOfScopeTemplate, language), false, true);

        // 多轮未解决兜底：客人在同一个还没结案的案件里连问了好几轮，说明 AI 大概率答不到点子上，
        // 不等它自己承认"不确定"，直接转人工——比继续绕圈子、让客人反复重复问题强。阈值后台可配置，
        // 见 SystemSettings.UnresolvedTurnThreshold（Admin → Settings）。
        if (caseEntity.Status != "closed" && recentMessages.Count(m => m.SenderRole == "guest") >= settings.UnresolvedTurnThreshold)
        {
            logger.LogInformation("Guest has asked {Count} times without resolution in case {CaseId}, escalating", recentMessages.Count(m => m.SenderRole == "guest"), caseEntity.Id);
            return new ChatReply(Templates.Pick(Templates.EscalationTemplate, language), true, true, EscalationReason: ReasonAiStuck, EscalationTrigger: "unresolved_turns");
        }

        var prompt = await BuildPromptAsync(caseEntity, recentMessages, userMessage, language, ct);
        var aiText = await gemini.GenerateAsync(prompt, ct);

        if (string.IsNullOrWhiteSpace(aiText))
        {
            logger.LogInformation("AI reply unavailable for case {CaseId}, escalating to coordinator", caseEntity.Id);
            return new ChatReply(Templates.Pick(Templates.EscalationTemplate, language), true, true, EscalationReason: ReasonAiStuck, EscalationTrigger: "ai_unavailable");
        }

        var (content, lowConfidence, hotelQuestion, frustrated, ambiguous) = ExtractSignals(aiText.Trim());

        // 关键词表(HotelAvailabilityKeywords)只是快速通道，覆盖不了"any room available"这种没预料到
        // 的自然问法——真正兜底靠模型自己在同一次生成里判断"这问题是不是只有酒店能回答"，不是另开一次
        // 并行调用做意图识别(多一次请求=多一倍延迟和成本，模型在生成正文时本来就已经在判断这件事，
        // 让它把判断结果带出来更省)。命中就跟关键词分支走一样的结果：模板话术+建 Inquiry，不当成
        // "AI 没把握"转协调员——协调员不用管这个，酒店才是该处理的人。
        if (hotelQuestion)
            return new ChatReply(Templates.Pick(Templates.HotelAvailabilityTemplate, language), false, true, true);

        // 意图不清晰(不知道客人在问什么)跟意图清晰但答不上来(CONFIDENCE:LOW)是两码事——前者反问
        // 客人一句澄清就够了，不用转人工；只有意图明确、AI 确实缺知识/政策依据时才转人工。
        if (ambiguous)
        {
            logger.LogInformation("Guest's intent unclear in case {CaseId}, asking for clarification", caseEntity.Id);
            return new ChatReply(content, false, false);
        }

        if (lowConfidence && settings.LowConfidenceEscalationEnabled)
        {
            logger.LogInformation("AI reported low confidence for case {CaseId}, escalating", caseEntity.Id);
            return new ChatReply(Templates.Pick(Templates.EscalationTemplate, language), true, true, EscalationReason: ReasonLowConfidence, EscalationTrigger: "low_confidence");
        }

        // 情绪判断跟置信度是两回事：答得对不代表客人不生气。这里不换成模板话术——AI 的回答本身
        // 照样有用，只是同时把协调员叫过来看一眼，免得一个已经不耐烦的客人还要在AI这边多耗一轮。
        if (frustrated && settings.FrustrationEscalationEnabled)
        {
            logger.LogInformation("Guest sounds frustrated in case {CaseId}, looping in coordinator", caseEntity.Id);
            return new ChatReply(content, true, false, EscalationReason: ReasonFrustrated, EscalationTrigger: "frustrated");
        }

        return new ChatReply(content, false, false);
    }

    // 模型自己在回复末尾附三行标记：置信度(答不准/问题太复杂时不硬憋一个回答给客人，直接转人工)、
    // 这问题是不是"只有酒店能核实"(比关键词表更能兜住没预料到的自然问法)，以及客人是不是听起来很不耐烦
    // (即使这次回答本身没问题，也提前叫协调员来看一眼)。三行都不展示给客人，解析完从内容里切掉。
    private static (string Content, bool LowConfidence, bool HotelQuestion, bool Frustrated, bool Ambiguous) ExtractSignals(string aiText)
    {
        var lines = aiText.Split('\n').ToList();
        var hotelQuestion = false;
        var lowConfidence = false;
        var frustrated = false;
        var ambiguous = false;

        if (lines.Count > 0 && lines[^1].Trim().StartsWith("FRUSTRATED:", StringComparison.OrdinalIgnoreCase))
        {
            frustrated = lines[^1].Trim().Contains("YES", StringComparison.OrdinalIgnoreCase);
            lines.RemoveAt(lines.Count - 1);
        }
        if (lines.Count > 0 && lines[^1].Trim().StartsWith("HOTEL_QUESTION:", StringComparison.OrdinalIgnoreCase))
        {
            hotelQuestion = lines[^1].Trim().Contains("YES", StringComparison.OrdinalIgnoreCase);
            lines.RemoveAt(lines.Count - 1);
        }
        if (lines.Count > 0 && lines[^1].Trim().StartsWith("AMBIGUOUS:", StringComparison.OrdinalIgnoreCase))
        {
            ambiguous = lines[^1].Trim().Contains("YES", StringComparison.OrdinalIgnoreCase);
            lines.RemoveAt(lines.Count - 1);
        }
        if (lines.Count > 0 && lines[^1].Trim().StartsWith("CONFIDENCE:", StringComparison.OrdinalIgnoreCase))
        {
            lowConfidence = lines[^1].Trim().Contains("LOW", StringComparison.OrdinalIgnoreCase);
            lines.RemoveAt(lines.Count - 1);
        }

        var content = string.Join('\n', lines).Trim();
        return (content.Length > 0 ? content : aiText, lowConfidence, hotelQuestion, frustrated, ambiguous);
    }

    private async Task<string> BuildPromptAsync(Case caseEntity, List<Message> recentMessages, string userMessage, string language, CancellationToken ct)
    {
        var sb = new StringBuilder();
        var languageName = language switch { "zh" => "Chinese", "mi" => "Māori", _ => "English" };
        sb.AppendLine("You are the customer support assistant for a travel disruption platform. Only answer questions about this specific booking, the disruption affecting it, and cancellation/rebooking policy. Do not offer to book new, unrelated hotels. Be concise (2-4 sentences).");
        sb.AppendLine("You have no access to live hotel room inventory or occupancy data, and no way to contact the hotel or trigger any check on the guest's behalf. Never say you are checking with the hotel, waiting on the hotel to confirm, or that someone will get back to them — you cannot make that happen.");
        sb.AppendLine($"Write your reply in {languageName}. Output only the reply text itself — no labels, prefixes, or language names.");
        sb.AppendLine("If you genuinely cannot tell what the guest is asking — the message is too vague, garbled, or could mean several different things — do not guess and do not answer. Instead, write a short question asking them to clarify what they mean, as your reply.");
        sb.AppendLine("After the reply, on its own new line, append exactly \"CONFIDENCE: HIGH\" or \"CONFIDENCE: LOW\". This is about your OWN knowledge, not whether the guest's intent is clear — use LOW when you understand exactly what the guest is asking but the policy excerpt or case context doesn't give you enough to answer it, or you're not confident the answer is fully correct for this specific booking. A human coordinator will take over in that case, so it's fine to say LOW. Do not use LOW just because the message was ambiguous — that's AMBIGUOUS below, not CONFIDENCE.");
        sb.AppendLine("After that, on its own new line, append exactly \"AMBIGUOUS: YES\" or \"AMBIGUOUS: NO\". Use YES exactly when you followed the instruction above and replied with a clarifying question instead of an answer. When AMBIGUOUS is YES, no coordinator is called in — the guest just gets asked to clarify, and CONFIDENCE above should still be HIGH (you're confident a clarifying question is the right reply).");
        sb.AppendLine("After that, on its own new line, append exactly \"HOTEL_QUESTION: YES\" or \"HOTEL_QUESTION: NO\". Use YES only if the guest is asking whether the original hotel can currently do something that only the hotel itself can confirm right now — e.g. whether it has a vacant/available room, whether it can extend the stay, or offer a room upgrade. This is a separate, automated system that will reach out to the hotel directly — it is not the coordinator hand-off, so mark YES for these even when your CONFIDENCE is HIGH.");
        sb.AppendLine("After that, on its own new line, append exactly \"FRUSTRATED: YES\" or \"FRUSTRATED: NO\". Use YES if the guest's message sounds frustrated, angry, or fed up (e.g. all caps, exclamation marks, complaints about the process) — even if you were able to answer their question with HIGH confidence. A human coordinator will be looped in when YES, but your answer will still be shown to the guest as-is.");
        sb.AppendLine();
        sb.AppendLine("=== Case context ===");
        sb.AppendLine($"Disruption: {caseEntity.Disruption?.Type} — {caseEntity.Disruption?.Title} ({caseEntity.Disruption?.Region})");
        sb.AppendLine($"Hotel: {caseEntity.Booking?.Hotel?.Name}");
        sb.AppendLine($"Stay: {caseEntity.Booking?.CheckIn:yyyy-MM-dd} to {caseEntity.Booking?.CheckOut:yyyy-MM-dd}, confirmation {caseEntity.Booking?.ConfirmationNo}");
        sb.AppendLine($"Case status: {caseEntity.Status}");

        // 酒店自己配的退款政策(没配就代表这家酒店不支持退款，见 CaseService.PolicyAllowsCancelAsync)
        // 直接喂给模型，这样客人问"为什么没有退款选项"时能照着这家酒店的真实政策回答，
        // 不是拿平台通用政策文档搪塞过去。
        if (caseEntity.Booking?.HotelId is { } policyHotelId)
        {
            var hotelPolicy = await hotelRepo.GetActiveRefundPolicyAsync(policyHotelId, ct);
            sb.AppendLine();
            sb.AppendLine(hotelPolicy is not null
                ? $"=== This hotel's own refund/cancellation policy ==={Environment.NewLine}{hotelPolicy.Content}"
                : "=== This hotel's own refund/cancellation policy ===\nThis hotel has not set up a refund policy, which means it does not support cancellation-for-refund for this booking. If the guest asks about a refund, explain this plainly rather than guessing at terms.");
        }

        var snippet = await FindRelevantSnippetAsync(userMessage, caseEntity.Booking?.GuestUserId, ct);
        if (snippet is not null)
        {
            sb.AppendLine();
            sb.AppendLine($"=== Relevant policy excerpt (source: {snippet.Value.DocName} v{snippet.Value.Version}) ===");
            sb.AppendLine(snippet.Value.Content);
        }

        if (recentMessages.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("=== Recent conversation ===");
            foreach (var m in recentMessages.TakeLast(10))
                sb.AppendLine($"{m.SenderRole}: {m.Content}");
        }

        sb.AppendLine();
        sb.AppendLine($"guest: {userMessage}");
        return sb.ToString();
    }

    // 真正的向量检索：问题和文档切片都转成 embedding，按余弦相似度取最相关的一段，
    // 不再用关键字命中计数（RAG-lite）。切片没有向量（比如 embedding API 当时不可用）时跳过它，
    // 不因为一个切片缺向量就整体退回关键字匹配。
    private async Task<(string Content, string DocName, int Version)?> FindRelevantSnippetAsync(string userMessage, Guid? guestUserId, CancellationToken ct)
    {
        var chunks = await ragRepository.GetSearchableChunksAsync(guestUserId, ct);
        var embeddable = chunks.Where(c => c.Embedding is { Length: > 0 }).ToList();
        if (embeddable.Count == 0) return null;

        var queryEmbedding = await gemini.EmbedAsync(userMessage, ct);
        if (queryEmbedding is null) return null;

        RagDocumentChunk? best = null;
        var bestScore = -1.0;
        foreach (var chunk in embeddable)
        {
            var score = CosineSimilarity(queryEmbedding, chunk.Embedding!);
            if (score > bestScore)
            {
                bestScore = score;
                best = chunk;
            }
        }

        // 相似度太低说明语料里没有相关内容，别硬塞一段不相关的进提示词。
        if (best is null || bestScore < 0.5) return null;
        return (best.Content, best.RagDocument?.Name ?? "", best.RagDocument?.Version ?? 0);
    }

    private static double CosineSimilarity(float[] a, float[] b)
    {
        var len = Math.Min(a.Length, b.Length);
        double dot = 0, normA = 0, normB = 0;
        for (var i = 0; i < len; i++)
        {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA == 0 || normB == 0) return 0;
        return dot / (Math.Sqrt(normA) * Math.Sqrt(normB));
    }
}
