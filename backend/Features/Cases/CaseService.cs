using System.Net;
using System.Text.Json;
using TravelDisruptionAgent.Api.Features.Auth;
using TravelDisruptionAgent.Api.Features.Chat;
using TravelDisruptionAgent.Api.Features.HotelPortal;
using TravelDisruptionAgent.Api.Infrastructure;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Email;
using TravelDisruptionAgent.Api.Infrastructure.Paging;

namespace TravelDisruptionAgent.Api.Features.Cases;

public class CaseService(
    ICaseRepository cases, IUserRepository users, IEmailService email, IChatService chat,
    IRagRepository ragRepository, GeminiClient gemini, CaseActionTokenService actionTokens,
    IHotelRepository hotelRepo, ILogger<CaseService> logger) : ICaseService
{
    private static MessageDto ToDto(Message m) => new(m.Id, m.CaseId, m.SenderRole, m.Content, m.Vote, m.Thread, m.CreatedAt, m.ReadAt);
    private static OptionDto ToDto(Option o) => new(o.Id, o.OptionType, o.Availability, o.Selected, o.PayloadJson, o.CreatedAt, o.CustomTitle, o.PerkNames);

    /// <summary>guest 只能看自己预订下的案件；coordinator 能看所有案件（多数案子系统自动跑，协调员只处理例外单，
    /// 不局限于自己名下的 assignee，方便转交/协助）。其它角色一律拒绝。</summary>
    private static async Task<Case> LoadAuthorizedCaseAsync(ICaseRepository repo, Guid caseId, Guid userId, string userRole, CancellationToken ct)
    {
        var c = await repo.FindWithBookingAsync(caseId, ct) ?? throw new CaseNotFoundException();

        var authorized = userRole switch
        {
            "coordinator" => true,
            "guest" => c.Booking?.GuestUserId == userId,
            _ => false,
        };
        if (!authorized) throw new CaseAccessDeniedException();
        return c;
    }

    public async Task<PagedResult<MessageDto>> GetMessagesAsync(Guid caseId, Guid userId, string userRole, string thread, int page, int pageSize, CancellationToken ct = default)
    {
        await LoadAuthorizedCaseAsync(cases, caseId, userId, userRole, ct);
        if (thread == "ai") await EnsureProactiveOpeningAsync(caseId, userRole, ct);
        else if (thread == "coordinator") await EnsureCoordinatorOpeningAsync(caseId, userRole, ct);

        var page_ = await cases.ListMessagesAsync(caseId, thread, page, pageSize, ct);
        var dtoList = page_.List.Select(ToDto).ToList();
        return PagedResult<MessageDto>.Create(dtoList, page_.Total, page_.Page, page_.PageSize);
    }

    /// <summary>进入即主动说明：客人第一次打开一个 ai 线程还没有任何消息的案件时，系统先说明中断情况，
    /// 不等客人先问。</summary>
    private async Task EnsureProactiveOpeningAsync(Guid caseId, string userRole, CancellationToken ct)
    {
        if (userRole != "guest") return;

        var existing = await cases.ListMessagesAsync(caseId, "ai", 1, 1, ct);
        if (existing.Total > 0) return;

        var full = await cases.FindFullAsync(caseId, ct);
        if (full is null) return;

        var guest = await users.FindByIdAsync(full.Booking!.GuestUserId, ct);
        var language = guest?.Language ?? "en";
        var hotelConfirmed = await cases.IsHotelConfirmedAsync(caseId, ct);
        var isReturningGuest = (await hotelRepo.GetReturningGuestIdsAsync([full.Booking.GuestUserId], full.Booking.HotelId, ct)).Count > 0;
        var opening = chat.BuildProactiveOpening(full, hotelConfirmed, language, isReturningGuest);

        var now = DateTimeOffset.UtcNow;
        await cases.AddMessageAsync(new Message
        {
            Id = Guid.NewGuid(),
            CaseId = caseId,
            SenderRole = "system",
            Thread = "ai",
            Content = opening,
            CreatedAt = now,
            UpdatedAt = now,
        }, ct);
        await cases.SaveChangesAsync(ct);
    }

    /// <summary>协调员线程原来"天生就该是空的"——用户反馈这个决定要推翻：客人默认看不到这条线程，
    /// 只有真的转人工（Case.EscalationReason 被设置）之后才出现，第一次打开时应该有条欢迎语，
    /// 不能让客人点开一个空白对话框自己猜发生了什么。</summary>
    private async Task EnsureCoordinatorOpeningAsync(Guid caseId, string userRole, CancellationToken ct)
    {
        if (userRole != "guest") return;

        var full = await cases.FindFullAsync(caseId, ct);
        if (full?.EscalationReason is null) return;

        var existing = await cases.ListMessagesAsync(caseId, "coordinator", 1, 1, ct);
        if (existing.Total > 0) return;

        var guest = await users.FindByIdAsync(full.Booking!.GuestUserId, ct);
        var language = guest?.Language ?? "en";
        var opening = language == "zh"
            ? "您好，我是您的专属协调员，请问有什么可以帮您？"
            : "Hi, I'm your coordinator — how can I help you with this?";

        var now = DateTimeOffset.UtcNow;
        await cases.AddMessageAsync(new Message
        {
            Id = Guid.NewGuid(),
            CaseId = caseId,
            SenderRole = "system",
            Thread = "coordinator",
            Content = opening,
            CreatedAt = now,
            UpdatedAt = now,
        }, ct);
        await cases.SaveChangesAsync(ct);
    }

    public async Task<MessageDto> PostMessageAsync(Guid caseId, Guid userId, string userRole, string content, string thread, CancellationToken ct = default)
    {
        var c = await LoadAuthorizedCaseAsync(cases, caseId, userId, userRole, ct);

        // AI 线程只有 AI 自己(经 PostChatMessageAsync)能发言，协调员/其它非 guest 角色一律不能
        // 往这条线程里插话——两条线程分开就是为了不让人工回复混进客人跟 AI 的对话记录里。
        if (thread == "ai" && userRole != "guest") throw new CaseAccessDeniedException();

        var now = DateTimeOffset.UtcNow;
        var message = new Message
        {
            Id = Guid.NewGuid(),
            CaseId = caseId,
            SenderRole = userRole,
            Thread = thread,
            Content = content,
            CreatedAt = now,
            UpdatedAt = now,
        };
        await cases.AddMessageAsync(message, ct);

        // 一案件一条专属对话线程：无论谁发消息，都通知"另一方"（不追踪对方对话框是否正打开，
        // 简化为每条新消息都生成一条通知，前端点开/标记已读即可清掉未读角标）。
        Guid? recipientId = userRole == "guest" ? c.AssigneeCoordinatorId : c.Booking?.GuestUserId;
        if (recipientId.HasValue)
        {
            await cases.AddNotificationAsync(new Notification
            {
                Id = Guid.NewGuid(),
                UserId = recipientId.Value,
                Channel = "in_app",
                Type = "case_message",
                Title = "New message on your case",
                Body = content.Length > 140 ? content[..140] + "…" : content,
                CaseId = caseId,
                SentAt = now,
                Success = true,
                CreatedAt = now,
                UpdatedAt = now,
            }, ct);
        }

        await cases.SaveChangesAsync(ct);
        return ToDto(message);
    }

    public async Task<List<MessageDto>> PostChatMessageAsync(Guid caseId, Guid guestUserId, string content, CancellationToken ct = default)
    {
        var guestMessage = await PostMessageAsync(caseId, guestUserId, "guest", content, "ai", ct);

        var full = await cases.FindFullAsync(caseId, ct) ?? throw new CaseNotFoundException();
        var guest = await users.FindByIdAsync(guestUserId, ct);
        var language = guest?.Language ?? "en";

        // 只读 ai 线程的历史当上下文——协调员线程的人工对话不该被喂给 AI。
        var recentPage = await cases.ListMessagesAsync(caseId, "ai", 1, 50, ct);
        var reply = await chat.GenerateReplyAsync(full, recentPage.List, content, language, ct);

        // 不管这个案件有没有分配协调员都要落这个字段——协调员的 Escalation queue 页签靠它过滤
        // (CoordinatorService.EscalationFilterMap)，之前这里只发了个 Notification，从没真正设置过
        // 这个字段，队列一直是空的。是否发 Notification 单独判断 AssigneeCoordinatorId，两件事不绑定。
        if (reply.Escalate)
        {
            full.EscalationReason = reply.EscalationReason;
            full.EscalationTrigger = reply.EscalationTrigger;
        }

        var now = DateTimeOffset.UtcNow;
        var aiMessage = new Message
        {
            Id = Guid.NewGuid(),
            CaseId = caseId,
            SenderRole = "ai",
            Thread = "ai",
            Content = reply.Content,
            Escalated = reply.Escalate,
            CreatedAt = now,
            UpdatedAt = now,
        };
        await cases.AddMessageAsync(aiMessage, ct);

        if (reply.Escalate && full.AssigneeCoordinatorId.HasValue)
        {
            await cases.AddNotificationAsync(new Notification
            {
                Id = Guid.NewGuid(),
                UserId = full.AssigneeCoordinatorId.Value,
                Channel = "in_app",
                Type = "escalation",
                Title = "Case needs human attention",
                Body = $"Guest message: {content}",
                CaseId = caseId,
                SentAt = now,
                Success = true,
                CreatedAt = now,
                UpdatedAt = now,
            }, ct);
        }

        // 客人问的是只有酒店能核实的事(空房/延期/升房)：单独给酒店落一条待办，跟协调员那条转人工
        // 通知互不依赖——就算这个案件没分配协调员，酒店这边也该收到。去重用 HasPendingInquiryAsync，
        // 避免客人反复问同类问题时重复打扰酒店。
        if (reply.NeedsHotelInquiry && full.Booking?.HotelId is { } hotelId
            && !await cases.HasPendingInquiryAsync(caseId, hotelId, ct))
        {
            await cases.AddInquiryAsync(new Inquiry
            {
                Id = Guid.NewGuid(), CaseId = caseId, HotelId = hotelId, Type = "defer",
                Status = "pending", RequestedAt = now, CreatedAt = now, UpdatedAt = now,
            }, ct);

            var hotelUserId = await cases.FindHotelAccountUserIdAsync(hotelId, ct);
            if (hotelUserId.HasValue)
            {
                await cases.AddNotificationAsync(new Notification
                {
                    Id = Guid.NewGuid(), UserId = hotelUserId.Value, Channel = "in_app",
                    Type = "new_inquiry", Title = "Guest is asking about room availability",
                    Body = $"Guest message: {content}",
                    CaseId = caseId, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
                }, ct);
            }
        }

        await cases.SaveChangesAsync(ct);
        return [guestMessage, ToDto(aiMessage)];
    }

    public async Task VoteMessageAsync(Guid caseId, Guid messageId, Guid userId, string userRole, string vote, CancellationToken ct = default)
    {
        await LoadAuthorizedCaseAsync(cases, caseId, userId, userRole, ct);
        var message = await cases.FindMessageAsync(messageId, caseId, ct) ?? throw new CaseNotFoundException();

        message.Vote = vote;
        message.UpdatedAt = DateTimeOffset.UtcNow;
        await cases.SaveChangesAsync(ct);
    }

    public async Task MarkThreadReadAsync(Guid caseId, Guid userId, string userRole, string thread, CancellationToken ct = default)
    {
        await LoadAuthorizedCaseAsync(cases, caseId, userId, userRole, ct);
        await cases.MarkThreadReadAsync(caseId, thread, userRole, userId, ct);
        await cases.SaveChangesAsync(ct);
    }

    public async Task MarkMessageReadAsync(Guid caseId, Guid messageId, Guid userId, string userRole, CancellationToken ct = default)
    {
        await LoadAuthorizedCaseAsync(cases, caseId, userId, userRole, ct);
        _ = await cases.FindMessageAsync(messageId, caseId, ct) ?? throw new CaseNotFoundException();
        await cases.MarkMessageReadAsync(messageId, userRole, ct);
        await cases.SaveChangesAsync(ct);
    }

    public async Task ConfirmRefundAsync(Guid caseId, Guid coordinatorId, decimal amount, string reason, Guid? optionId, CancellationToken ct = default)
    {
        var c = await cases.FindWithBookingAsync(caseId, ct) ?? throw new CaseNotFoundException();

        var now = DateTimeOffset.UtcNow;
        await cases.AddRefundConfirmationAsync(new RefundConfirmation
        {
            Id = Guid.NewGuid(),
            CaseId = caseId,
            OptionId = optionId,
            Amount = amount,
            Reason = reason,
            ConfirmedByCoordinatorId = coordinatorId,
            ConfirmedAt = now,
            CreatedAt = now,
            UpdatedAt = now,
        }, ct);
        await cases.SaveChangesAsync(ct);

        logger.LogInformation("Refund confirmed for case {CaseId}: {Amount} by coordinator {CoordinatorId}", caseId, amount, coordinatorId);

        // 邮件通知仅在协调员确认之后发送，不因为发信失败而回滚已经落库的确认记录。
        if (c.Booking is not null)
        {
            var guest = await users.FindByIdAsync(c.Booking.GuestUserId, ct);
            if (guest is not null)
            {
                try
                {
                    var caseLink = CaseEmailLinks.BuildCaseLink(caseId);
                    var htmlBody = EmailTemplate.Build("Your refund has been confirmed", $"""
                        <p>Your refund of {amount:F2} {c.Booking.Currency} has been confirmed by our team. Reason: {WebUtility.HtmlEncode(reason)}</p>
                        {EmailTemplate.Button(caseLink, "View this case")}
                        """);
                    await email.SendEmailAsync(
                        guest.Email,
                        "Your refund has been confirmed",
                        $"Your refund of {amount:F2} {c.Booking.Currency} has been confirmed by our team. Reason: {reason}\n\nView this case: {caseLink}",
                        ct, htmlBody);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Failed to send refund confirmation email for case {CaseId}", caseId);
                }
            }
        }
    }

    public async Task<RefundStatusDto> GetRefundStatusAsync(Guid caseId, CancellationToken ct = default)
    {
        var confirmation = await cases.FindRefundConfirmationAsync(caseId, ct);
        return confirmation is null
            ? new RefundStatusDto(false, null, null, null)
            : new RefundStatusDto(true, confirmation.Amount, confirmation.Reason, confirmation.ConfirmedAt);
    }

    private static string StatusLabel(string status) => status switch
    {
        "pending" => "Awaiting confirmation",
        "in_progress" => "In progress",
        "closed" => "Completed",
        _ => status,
    };

    private static string? PrimaryHotelImage(Case c)
    {
        var roomType = c.Booking?.RoomType;
        if (roomType is not null && roomType.ImageUrls.Count > 0)
            return roomType.ImageUrls[0];

        var hotel = c.Booking?.Hotel;
        if (hotel is null || hotel.ImageUrls.Count == 0) return null;
        var index = Math.Clamp(hotel.PrimaryImageIndex, 0, hotel.ImageUrls.Count - 1);
        return hotel.ImageUrls[index];
    }

    public async Task<List<CaseSummaryDto>> GetMyCasesAsync(Guid guestUserId, bool includeClosed, CancellationToken ct = default)
    {
        var list = await cases.ListForGuestAsync(guestUserId, includeClosed, ct);
        return [.. list.Select(c => new CaseSummaryDto(
            c.Id, c.Status, StatusLabel(c.Status), c.Priority,
            c.Disruption?.Type, c.Disruption?.Title,
            c.Booking?.Hotel?.Name, c.Booking?.CheckIn, c.Booking?.CheckOut, c.CreatedAt,
            DisruptionId: c.DisruptionId,
            DisruptionDescription: c.Disruption?.RawSignalText,
            ConfirmationNo: c.Booking?.ConfirmationNo,
            HotelImageUrl: PrimaryHotelImage(c)))];
    }

    public async Task<CaseSummaryDto> GetCaseAsync(Guid caseId, Guid userId, string userRole, CancellationToken ct = default)
    {
        await LoadAuthorizedCaseAsync(cases, caseId, userId, userRole, ct);
        var c = await cases.FindFullAsync(caseId, ct) ?? throw new CaseNotFoundException();
        var (status, statusLabel) = await ResolveDisplayStatusAsync(c, ct);
        var unreadAi = await cases.CountUnreadInThreadAsync(caseId, "ai", userRole, ct);
        var unreadCoordinator = await cases.CountUnreadInThreadAsync(caseId, "coordinator", userRole, ct);
        var guest = c.Booking is null ? null : await users.FindByIdAsync(c.Booking.GuestUserId, ct);
        var assignee = c.AssigneeCoordinatorId.HasValue ? await users.FindByIdAsync(c.AssigneeCoordinatorId.Value, ct) : null;
        return new CaseSummaryDto(
            c.Id, status, statusLabel, c.Priority,
            c.Disruption?.Type, c.Disruption?.Title,
            c.Booking?.Hotel?.Name, c.Booking?.CheckIn, c.Booking?.CheckOut, c.CreatedAt,
            c.EscalationReason is not null, unreadAi, unreadCoordinator,
            c.DisruptionId, c.Disruption?.RawSignalText, c.Booking?.ConfirmationNo,
            guest?.Nickname, guest?.AvatarUrl, guest?.Email, guest?.Phone,
            c.AssigneeCoordinatorId, assignee?.Nickname,
            HotelImageUrl: PrimaryHotelImage(c),
            EscalationReason: c.EscalationReason, EscalationReviewedAsReasonable: c.EscalationReviewedAsReasonable, EscalationReviewNote: c.EscalationReviewNote);
    }

    /// <summary>协调员给这次AI转人工打分：合理还是不合理，不合理要说明原因。只有真的转过人工的
    /// 案件才能复核——没转人工的案件没有"这次转人工对不对"这回事。</summary>
    public async Task ReviewEscalationAsync(Guid caseId, Guid coordinatorUserId, bool reasonable, string? note, CancellationToken ct = default)
    {
        var c = await cases.FindFullAsync(caseId, ct) ?? throw new CaseNotFoundException();
        if (c.EscalationReason is null) throw new EscalationNotFoundException();

        c.EscalationReviewedAsReasonable = reasonable;
        c.EscalationReviewNote = reasonable ? null : note;
        c.EscalationReviewedByUserId = coordinatorUserId;
        c.EscalationReviewedAt = DateTimeOffset.UtcNow;
        c.UpdatedAt = DateTimeOffset.UtcNow;
        await cases.SaveChangesAsync(ct);
    }

    // 案件详情页头部徽章:客人关心的是"进展到哪一步"，不是内部 Case.Status——那个字段从建案到结案
    // 全程都是 "pending"(见 DEVELOPMENT_STANDARDS.md 1.6)，没法区分"酒店还没回复/有方案能选了/
    // 客人已经选完"。这里按真实信号(Option.Availability/Selected)推算，不改 Case.Status 本身。
    //
    // 三种方案类型里，只有 defer(原酒店延期)是真的"等原酒店回复"；alternate 是候补酒店（可能是
    // 完全不同的一家酒店）确认空房，跟原酒店无关；cancel 草稿一生成就是 available，是否该展示给
    // 客人由 PolicyAllowsCancelAsync 判断（只影响聊天消息文案是否提它，Option 行本身不受影响），
    // 不代表任何一方"回复"了什么。所以判断"是否已经有能选的方案"时排除 cancel（否则客人只是点开
    // "查看方案"自动生成草稿就会误判成有进展），但徽章文案不能写死"酒店确认"——三种来源都可能是
    // 这个状态的成因，笼统写"有方案可选"才不会在 alternate/cancel 触发时说错话。
    private async Task<(string Status, string Label)> ResolveDisplayStatusAsync(Case c, CancellationToken ct)
    {
        if (c.Status == "closed") return ("closed", "Completed");

        var options = await cases.ListOptionsAsync(c.Id, ct);
        if (options.Any(o => o.Selected)) return ("guest_selected", "Option selected");
        if (options.Any(o => o.OptionType != "cancel" && o.Availability != "pending"))
            return ("awaiting_guest", "New options ready — pick one");

        return ("awaiting_hotel", "Awaiting hotel confirmation");
    }

    // ---- P5/P6/P7 ----

    public async Task<List<OptionDto>> GetOptionsAsync(Guid caseId, Guid userId, string userRole, CancellationToken ct = default)
    {
        var c = await LoadAuthorizedCaseAsync(cases, caseId, userId, userRole, ct);
        var hotelId = c.Booking?.HotelId;
        var list = await cases.ListOptionsAsync(caseId, ct);
        var visible = new List<Option>();
        foreach (var o in list)
        {
            if (o.CoordinatorVisibilityOverride == false) continue;
            if (o.CoordinatorVisibilityOverride != true && o.OptionType == "cancel" && hotelId.HasValue && !await PolicyAllowsCancelAsync(hotelId.Value, ct)) continue;
            visible.Add(o);
        }
        return [.. visible.Select(ToDto)];
    }

    public async Task SelectOptionAsync(Guid caseId, Guid optionId, Guid userId, string userRole, CancellationToken ct = default)
    {
        await LoadAuthorizedCaseAsync(cases, caseId, userId, userRole, ct);
        var option = await cases.FindOptionAsync(optionId, caseId, ct) ?? throw new CaseNotFoundException();
        if (option.Availability == "unavailable") throw new CaseNotFoundException();

        // 仅选未确认不打扰：这里只是把候选项标成"已选"，P7 的 confirm-execution 才会真正通知酒店/落地。
        // 同一个接口做成开关——已经选中的再点一次就是取消选择，客人选完想反悔、回到"还没选定"状态
        // 之前没有路径，只能顶掉换另一个方案，选不出自己想要的"先都不选"这种中间态。
        if (option.Selected)
        {
            option.Selected = false;
            // 反悔(取消选中)必须连同 P7 的执行确认一起撤：ExecutionRequestedAt 是酒店 H2 卡和 H1 卡
            // "客人已拍板"状态的判定依据，只清 Selected 不清它的话，酒店一确认就会把客人已经
            // 反悔的改订强行执行掉。
            option.ExecutionRequestedAt = null;
        }
        else
        {
            await cases.UnselectOtherOptionsAsync(caseId, optionId, ct);
            option.Selected = true;
        }
        option.UpdatedAt = DateTimeOffset.UtcNow;
        await cases.SaveChangesAsync(ct);
    }

    public async Task<ProposeDeferDatesResultDto> ProposeDeferDatesAsync(
        Guid caseId, Guid optionId, DateOnly newCheckIn, DateOnly newCheckOut, Guid userId, string userRole, CancellationToken ct = default)
    {
        var c = await LoadAuthorizedCaseAsync(cases, caseId, userId, userRole, ct);
        if (c.Status == "closed")
            return new ProposeDeferDatesResultDto(false, "This case has already been resolved — no further changes can be made here.");

        var option = await cases.FindOptionAsync(optionId, caseId, ct) ?? throw new CaseNotFoundException();
        if (option.OptionType != "defer")
            return new ProposeDeferDatesResultDto(false, "This isn't a deferral option.");

        var booking = c.Booking!;
        var now = DateTimeOffset.UtcNow;

        // payload 存的是相对原 check-in 的天数偏移(见 OptionsAdminService.BuildDraftOptionsAsync /
        // CaseService.ExecuteOptionAsync)，客人提的是绝对日期——换算成同一种表示，执行时那段代码不用改。
        option.PayloadJson = JsonSerializer.Serialize(new
        {
            new_check_in_offset_days = newCheckIn.DayNumber - booking.CheckIn.DayNumber,
            new_check_out_offset_days = newCheckOut.DayNumber - booking.CheckIn.DayNumber,
            fee_diff = 0m,
            currency = booking.Currency,
        });
        // 客人换了日期，酒店之前批准/拒绝的是旧方案，不能沿用——重新变成待确认，不管之前是什么状态。
        option.Availability = "pending";
        option.UpdatedAt = now;

        var inquiry = await cases.FindDeferInquiryAsync(caseId, ct);
        if (inquiry is not null && inquiry.Status != "pending")
        {
            inquiry.Status = "pending";
            inquiry.RespondedAt = null;
            inquiry.RejectReason = null;
            inquiry.UpdatedAt = now;
        }

        await cases.AddMessageAsync(new Message
        {
            Id = Guid.NewGuid(), CaseId = caseId, SenderRole = "system", Thread = "ai",
            Content = $"You proposed new dates for the deferral: {newCheckIn:yyyy-MM-dd} → {newCheckOut:yyyy-MM-dd}. We've asked the hotel to reconfirm.",
            CreatedAt = now, UpdatedAt = now,
        }, ct);

        await cases.SaveChangesAsync(ct);
        await NotifyHotelOfProposedDatesAsync(c, booking, newCheckIn, newCheckOut, ct);

        return new ProposeDeferDatesResultDto(true, "We've asked the hotel to reconfirm these dates.");
    }

    private async Task NotifyHotelOfProposedDatesAsync(Case full, Booking booking, DateOnly newCheckIn, DateOnly newCheckOut, CancellationToken ct)
    {
        var hotelUserId = await cases.FindHotelAccountUserIdAsync(booking.HotelId, ct);
        if (hotelUserId is null) return;

        var now = DateTimeOffset.UtcNow;
        var body = $"Guest proposed different dates for booking {booking.ConfirmationNo}: {newCheckIn:yyyy-MM-dd} → {newCheckOut:yyyy-MM-dd}. Please reconfirm.";
        await cases.AddNotificationAsync(new Notification
        {
            Id = Guid.NewGuid(), UserId = hotelUserId.Value, Channel = "in_app",
            Type = "defer_dates_proposed", Title = "Guest proposed different dates",
            Body = body, CaseId = full.Id, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
        }, ct);

        var hotelEmail = await cases.FindHotelAccountEmailAsync(booking.HotelId, ct);
        if (string.IsNullOrWhiteSpace(hotelEmail)) return;
        var hotelHomeLink = CaseEmailLinks.BuildHotelHomeLink();
        var htmlBody = EmailTemplate.Build("Guest proposed different dates", $"""
            <p>{WebUtility.HtmlEncode(body)}</p>
            {EmailTemplate.Button(hotelHomeLink, "Open your dashboard")}
            """);
        try
        {
            await email.SendEmailAsync(hotelEmail, "Guest proposed different dates", $"{body}\n\nOpen your dashboard: {hotelHomeLink}", ct, htmlBody);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to send proposed-dates email to {Email}", hotelEmail);
        }
    }

    public async Task<ConfirmExecutionResultDto> ConfirmExecutionAsync(Guid caseId, Guid optionId, Guid userId, string userRole, CancellationToken ct = default)
    {
        var c = await LoadAuthorizedCaseAsync(cases, caseId, userId, userRole, ct);
        var option = await cases.FindOptionAsync(optionId, caseId, ct) ?? throw new CaseNotFoundException();
        var full = await cases.FindFullAsync(caseId, ct) ?? throw new CaseNotFoundException();
        var now = DateTimeOffset.UtcNow;

        // 一个案件只能生效一次:已经改订或退款确认过之后,不能再执行别的方案造成矛盾状态。
        if (full.Booking?.Status == "rebooked" || await cases.FindRefundConfirmationAsync(caseId, ct) is not null)
        {
            return new ConfirmExecutionResultDto("failed", "This case has already been resolved — no further changes can be made here.", null, null, null);
        }

        // Selected 只代表客人在比较页里的临时选择；ExecutionRequestedAt 才代表客人已经在
        // 最终确认页提交。重复提交时直接返回当前处理状态，避免重复通知酒店或协调员。
        if (option.ExecutionRequestedAt.HasValue)
        {
            var message = option.OptionType == "cancel"
                ? "Your cancellation is already awaiting coordinator confirmation."
                : "Your choice has already been submitted and is awaiting final processing.";
            return new ConfirmExecutionResultDto("processing", message, null, null, null);
        }

        if (option.OptionType == "cancel")
        {
            // 退款强制规则：这里绝不直接把退款标记完成，只落一条"待协调员确认"的信号（升级通知），
            // 真正生效要等 CasesController 的 /refund/confirm（Task 6）。
            option.ExecutionRequestedAt = now;
            option.UpdatedAt = now;
            if (full.AssigneeCoordinatorId.HasValue)
            {
                await cases.AddNotificationAsync(new Notification
                {
                    Id = Guid.NewGuid(), UserId = full.AssigneeCoordinatorId.Value, Channel = "in_app",
                    Type = "refund_pending", Title = "Refund needs confirmation",
                    Body = $"Guest selected cancellation for case {caseId}, please confirm the refund.",
                    CaseId = caseId, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
                }, ct);
            }
            await cases.SaveChangesAsync(ct);
            return new ConfirmExecutionResultDto("processing", "Your cancellation has been submitted and is awaiting coordinator confirmation before any refund is issued.", null, null, null);
        }

        if (option.Availability == "unavailable")
        {
            await EscalateAsync(full, "Selected option became unavailable", ct);
            return new ConfirmExecutionResultDto("failed", "This option is no longer available. We've transferred your case to a coordinator — please check your conversation.", null, null, null);
        }

        if (option.Availability == "pending")
        {
            // 仅在这里(客人真正点了P7确认)才算"客人已选定方案"，酒店的H2待办才能出现这条——
            // 光是P5选中(Selected=true)不够，不能在客人还没确认时就去打扰酒店。
            option.ExecutionRequestedAt = now;
            // defer 问的还是原酒店"能不能接这单延期"：如果 H1 询单还停在 pending，同一件事已经有
            // 一张待响应的卡了，不能再按"客人已选方案"通知一遍——那在酒店端看起来像第二件待办。
            // 只提醒酒店尽快响应已有请求，H1 卡靠 InquiryItemDto.GuestCommitted 展示"客人已拍板"。
            // alternate 不走这支：候补酒店从来没有 H1，H2 就是它唯一的待办。
            if (option.OptionType == "defer" && full.Booking is not null &&
                await cases.HasPendingInquiryAsync(caseId, full.Booking.HotelId, ct))
                await NotifyHotelOfGuestCommitmentAsync(full, option, ct);
            else
                await NotifyHotelAsync(full, option, ct);
            await cases.SaveChangesAsync(ct);
            await NotifyGuestSelectionSubmittedAsync(full, option, ct);
            return new ConfirmExecutionResultDto("processing", "Submitted — we're waiting for the hotel to confirm. We'll update you as soon as we hear back.", null, null, null);
        }

        // Availability == "available": 已确认可直接生效。
        option.ExecutionRequestedAt = now;
        option.UpdatedAt = now;
        return await ExecuteOptionAsync(full, option, ct);
    }

    /// <summary>真正让改订生效：改日期/换酒店、生成新确认号、发确认邮件。
    /// 两个入口都会走到这里：客人自己点确认执行（选项本来就 available），或者酒店在 H1/H2 confirm 之后
    /// 补上这一步（客人已经选定、之前卡在 pending 等酒店回复）。</summary>
    private async Task<ConfirmExecutionResultDto> ExecuteOptionAsync(Case full, Option option, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        using var payload = JsonDocument.Parse(option.PayloadJson);
        var root = payload.RootElement;
        var booking = full.Booking!;
        var originalHotelId = booking.HotelId;

        if (option.OptionType == "defer" &&
            root.TryGetProperty("new_check_in_offset_days", out var ciEl) &&
            root.TryGetProperty("new_check_out_offset_days", out var coEl))
        {
            // offset 是"比原定入住日期晚几天"，基准必须是 booking 原本的 check-in，不是"今天"——
            // 用执行确认那一刻的日期当基准会导致新日期跟"什么时候点确认"绑定，快到期的订单
            // 甚至可能算出比原定日期更早的"延期"结果(真实复现过：原定08-29入住，08-26点确认，
            // "3天后"=08-29，延期形同没延，日期完全没变)。改成相对原 check-in 偏移，语义自洽。
            var originalCheckIn = booking.CheckIn;
            booking.CheckIn = originalCheckIn.AddDays(ciEl.GetInt32());
            booking.CheckOut = originalCheckIn.AddDays(coEl.GetInt32());
        }
        else if (option.OptionType == "alternate" && root.TryGetProperty("hotel", out var hotelNameEl))
        {
            var altHotel = await cases.FindHotelByNameAsync(hotelNameEl.GetString() ?? "", ct);
            if (altHotel is not null) booking.HotelId = altHotel.Id;
        }

        booking.Status = "rebooked";
        booking.ConfirmationNo = $"CONF-{Guid.NewGuid().ToString("N")[..8].ToUpperInvariant()}";
        booking.UpdatedAt = now;

        // "cancel" options never reach here — ConfirmExecutionAsync intercepts them earlier for the
        // forced refund-confirmation flow (Task 6), so every case that lands here is a real rebooking.
        // Reuse the same close-reason constant OpsService's rebooking-retention KPI already matches on
        // ("改订成功结案") so an auto-closed-loop case counts toward that metric like a manual one does.
        full.Status = "closed";
        full.CloseReason = "改订成功结案";
        full.ResultSummary = $"Booking updated automatically — new confirmation {booking.ConfirmationNo}.";
        full.ClosedAt = now;
        full.UpdatedAt = now;

        // 案件状态变了、邮件也发了，但对话记录本身从没跟着写过一句——客人回到对话框看到的
        // 还是"等酒店确认"那几条旧消息，跟侧栏"已完成"状态对不上。补一条系统消息。
        await cases.AddMessageAsync(new Message
        {
            Id = Guid.NewGuid(), CaseId = full.Id, SenderRole = "system",
            Content = $"Good news — your booking has been updated. New confirmation: {booking.ConfirmationNo}, " +
                $"check-in {booking.CheckIn:yyyy-MM-dd} → check-out {booking.CheckOut:yyyy-MM-dd}.",
            CreatedAt = now, UpdatedAt = now,
        }, ct);

        await NotifyHotelAsync(full, option, ct);
        // 客人换去了别家：原酒店只在 H1 那次"能不能延期"被问过一次,之后再没收到任何后续消息——
        // 它可能还在按"这客人要延期"给这间房留着。改订生效时如果最终酒店跟原酒店不是同一家,
        // 得单独告诉原酒店这单已经不用它了。
        if (originalHotelId != booking.HotelId) await NotifyOriginalHotelReleasedAsync(full, originalHotelId, booking, ct);

        // 改订生效即视为"原酒店请求"已有结论：还停在 pending 的 H1 询单一并闭环。正常路径走到这里
        // 时 H1 早已被酒店自己点掉，这段是给旧数据/并发窗口兜底——不然酒店待办里会留下客人早已
        // 改订完、却永远处理不完的卡。跟其它字段一起在下面这次 SaveChanges 原子落库。
        foreach (var inquiry in await cases.ListPendingInquiriesAsync(full.Id, ct))
        {
            inquiry.Status = "accepted";
            inquiry.RespondedAt = now;
            inquiry.UpdatedAt = now;
        }
        await cases.SaveChangesAsync(ct);

        var guest = await users.FindByIdAsync(booking.GuestUserId, ct);
        if (guest is not null)
        {
            try
            {
                var caseLink = CaseEmailLinks.BuildCaseLink(full.Id);
                var htmlBody = EmailTemplate.Build("Your booking has been updated", $"""
                    <p>Your new confirmation number is <strong>{WebUtility.HtmlEncode(booking.ConfirmationNo)}</strong>.</p>
                    <p>Check-in {booking.CheckIn:yyyy-MM-dd}, check-out {booking.CheckOut:yyyy-MM-dd}.</p>
                    {EmailTemplate.Button(caseLink, "View this case")}
                    """);
                await email.SendEmailAsync(guest.Email, "Your booking has been updated",
                    $"Your new confirmation number is {booking.ConfirmationNo}. Check-in {booking.CheckIn:yyyy-MM-dd}, check-out {booking.CheckOut:yyyy-MM-dd}.\n\nView this case: {caseLink}", ct, htmlBody);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to send rebooking confirmation email for case {CaseId}", full.Id);
            }
        }

        return new ConfirmExecutionResultDto("success", "Your booking has been updated.", booking.ConfirmationNo, booking.CheckIn, booking.CheckOut);
    }

    /// <summary>酒店在 H1/H2 确认后调用：把选项标为可用，如果客人已经点过 P7 确认执行
    /// (ExecutionRequestedAt 非空，之前卡在 pending 等酒店回复)就直接执行改订生效；否则只是解锁选项、
    /// 通知客人自己来确认。判断必须看 ExecutionRequestedAt 而不是 Selected——客人仅在 P5 选中还没
    /// 确认执行时，酒店这边确认可用不能代客改订。</summary>
    public async Task<ConfirmExecutionResultDto?> ResolveOptionAvailableAsync(Guid caseId, Guid optionId, CancellationToken ct = default)
    {
        var option = await cases.FindOptionAsync(optionId, caseId, ct) ?? throw new CaseNotFoundException();
        var full = await cases.FindFullAsync(caseId, ct) ?? throw new CaseNotFoundException();

        // 幂等保护:酒店端"Confirm deferral"/"Confirm"按钮连点两次(或网络重试)时，这个方法
        // 会被同一个已经 available 的选项调用第二次——不加这道guard的话，客人已选定的分支会
        // 重新跑一次 ExecuteOptionAsync，生成第二个改订确认号、案件被二次"关闭"，数据直接错乱。
        if (option.Availability == "available") return null;

        option.Availability = "available";
        option.UpdatedAt = DateTimeOffset.UtcNow;

        if (option.ExecutionRequestedAt is null)
        {
            await cases.SaveChangesAsync(ct);
            await NotifyGuestOptionConfirmedAsync(full, option, ct);
            return null;
        }

        return await ExecuteOptionAsync(full, option, ct);
    }

    private static string OptionTitle(Option o) => o.OptionType switch
    {
        "defer" => "Defer & keep original hotel",
        "alternate" => "Move to an alternative stay",
        "cancel" => "Cancel & refund",
        "custom" => o.CustomTitle ?? "Special offer",
        _ => o.OptionType,
    };

    /// <summary>退款政策要不要展示给客人得看这家酒店自己配没配政策——没配就代表这家酒店不支持退款，
    /// 不回退到平台默认政策（那是给"取消费怎么算"这类通用问答兜底用的，不能替酒店做"支不支持退款"这个决定）。
    /// 配了政策再让 Gemini 读摘录判断这份政策具体怎么说；没配 Gemini key 时保守放行（总比卡住客人、
    /// 有退款权利却看不到强）。</summary>
    private async Task<bool> PolicyAllowsCancelAsync(Guid hotelId, CancellationToken ct)
    {
        var hotelPolicy = await hotelRepo.GetActiveRefundPolicyAsync(hotelId, ct);
        if (hotelPolicy is null) return false;

        var section = hotelPolicy.Content.Split("\n## ")
            .FirstOrDefault(s => s.Contains("refund", StringComparison.OrdinalIgnoreCase))
            ?? hotelPolicy.Content;

        var prompt = $"Cancellation policy excerpt:\n{section.Trim()}\n\nA guest's stay was disrupted through no fault of their own and " +
            "may want to cancel for a refund. Based only on the policy above, should we offer them a cancellation/refund option? " +
            "Reply with exactly one word: yes or no.";
        var verdict = await gemini.GenerateAsync(prompt, ct);
        return verdict is null || verdict.TrimStart().StartsWith("yes", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>酒店在 H1/H2 确认、客人还没选定时调用：把确认的方案（连同其他已可用的方案，退款选项先过一遍
    /// 政策判断）推进案件聊天窗口，同时落一条应用内通知 + 发邮件——客人当下不在聊天页也能看到。</summary>
    private async Task NotifyGuestOptionConfirmedAsync(Case full, Option confirmed, CancellationToken ct)
    {
        var guest = await users.FindByIdAsync(full.Booking!.GuestUserId, ct);
        if (guest is null) return;

        var others = (await cases.ListOptionsAsync(full.Id, ct))
            .Where(o => o.Id != confirmed.Id && o.Availability == "available");
        var lines = new List<string> { $"Good news — the hotel confirmed: {OptionTitle(confirmed)}." };
        if (confirmed.PerkNames.Count > 0) lines.Add($"Includes: {string.Join(", ", confirmed.PerkNames)}.");

        foreach (var o in others)
        {
            if (o.CoordinatorVisibilityOverride == false) continue;
            if (o.CoordinatorVisibilityOverride != true && o.OptionType == "cancel" && full.Booking?.HotelId is { } hotelId && !await PolicyAllowsCancelAsync(hotelId, ct)) continue;
            lines.Add($"Also available: {OptionTitle(o)}.");
        }
        lines.Add("Open your options to compare and confirm.");

        var now = DateTimeOffset.UtcNow;
        await cases.AddMessageAsync(new Message
        {
            Id = Guid.NewGuid(), CaseId = full.Id, SenderRole = "system", Content = string.Join(" ", lines),
            CreatedAt = now, UpdatedAt = now,
        }, ct);

        await cases.AddNotificationAsync(new Notification
        {
            Id = Guid.NewGuid(), UserId = guest.Id, Channel = "in_app", Type = "option_confirmed",
            Title = "The hotel confirmed your option", Body = $"{OptionTitle(confirmed)} is ready — open the app to confirm.",
            CaseId = full.Id, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
        }, ct);
        await cases.SaveChangesAsync(ct);

        try
        {
            var caseLink = CaseEmailLinks.BuildCaseLink(full.Id);
            var listItems = string.Concat(lines.Select(l => $"<li>{WebUtility.HtmlEncode(l)}</li>"));
            var htmlBody = EmailTemplate.Build("The hotel confirmed your option", $"""
                <ul style="padding-left:20px;margin:0 0 16px;">{listItems}</ul>
                {EmailTemplate.Button(caseLink, "Open your options")}
                """);
            await email.SendEmailAsync(guest.Email, "The hotel confirmed your option",
                $"{OptionTitle(confirmed)} is now available for your booking {full.Booking.ConfirmationNo}. Sign in to compare and confirm.\n\nView this case: {caseLink}", ct, htmlBody);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to send option-confirmed email for case {CaseId}", full.Id);
        }
    }

    public async Task NotifyGuestOfInquiryDecisionAsync(Guid caseId, bool accepted, string? rejectReason, CancellationToken ct = default)
    {
        var full = await cases.FindFullAsync(caseId, ct);
        if (full?.Booking is null) return;
        var guest = await users.FindByIdAsync(full.Booking.GuestUserId, ct);
        if (guest is null) return;

        var hotelName = full.Booking.Hotel?.Name ?? "the hotel";
        var now = DateTimeOffset.UtcNow;
        var systemText = accepted
            ? $"Good news — {hotelName} has confirmed they can accommodate your request."
            : $"{hotelName} wasn't able to accommodate this request.{(string.IsNullOrWhiteSpace(rejectReason) ? "" : $" Reason: {rejectReason}.")} Take a look at your other options.";

        await cases.AddMessageAsync(new Message
        {
            Id = Guid.NewGuid(), CaseId = caseId, SenderRole = "system", Thread = "ai", Content = systemText,
            CreatedAt = now, UpdatedAt = now,
        }, ct);

        await cases.AddNotificationAsync(new Notification
        {
            Id = Guid.NewGuid(), UserId = guest.Id, Channel = "in_app", Type = "inquiry_resolved",
            Title = accepted ? "The hotel confirmed your request" : "The hotel couldn't accommodate your request",
            Body = systemText, CaseId = caseId, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
        }, ct);

        // 只有唯一一个"可选、还没选"的方案时才在邮件里放一键确认按钮——多个候选方案时帮客人瞎选比不给按钮更糟。
        var candidates = (await cases.ListOptionsAsync(caseId, ct))
            .Where(o => o.Availability == "available" && !o.Selected).ToList();
        var singleOption = candidates.Count == 1 ? candidates[0] : null;

        var caseLink = CaseEmailLinks.BuildCaseLink(caseId);
        string plainBody;
        string htmlBody;
        if (accepted && singleOption is not null)
        {
            var token = actionTokens.Create(new CaseActionPayload(caseId, singleOption.Id, guest.Id));
            var actionLink = CaseEmailLinks.BuildCaseActionLink(token);
            plainBody = $"{systemText}\n\nConfirm — {OptionTitle(singleOption)}: {actionLink}\n\nOr view all options: {caseLink}";
            htmlBody = EmailTemplate.Build("The hotel confirmed your request", $"""
                <p>{WebUtility.HtmlEncode(systemText)}</p>
                {EmailTemplate.Button(actionLink, $"Confirm — {OptionTitle(singleOption)}")}
                <p><a href="{caseLink}">Or view all options</a></p>
                """);
        }
        else
        {
            plainBody = $"{systemText}\n\nView this case: {caseLink}";
            htmlBody = EmailTemplate.Build(accepted ? "The hotel confirmed your request" : "Update on your request", $"""
                <p>{WebUtility.HtmlEncode(systemText)}</p>
                {EmailTemplate.Button(caseLink, "View this case")}
                """);
        }

        await cases.SaveChangesAsync(ct);

        try
        {
            await email.SendEmailAsync(guest.Email, accepted ? "The hotel confirmed your request" : "Update on your request", plainBody, ct, htmlBody);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to send inquiry-decision email for case {CaseId}", caseId);
        }
    }

    /// <summary>选替代住宿要通知候补酒店,选原店延期要通知原酒店——不能一律通知预订当前所在的酒店，
    /// 尤其是 alternate 类型在"待酒店确认"阶段(booking 还没搬家)时，目标酒店和 booking.HotelId 是两回事。</summary>
    private async Task<Guid?> ResolveTargetHotelIdAsync(Case full, Option option, CancellationToken ct)
    {
        if (option.OptionType == "alternate")
        {
            using var payload = JsonDocument.Parse(option.PayloadJson);
            if (payload.RootElement.TryGetProperty("hotel", out var hotelNameEl))
            {
                var targetHotel = await cases.FindHotelByNameAsync(hotelNameEl.GetString() ?? "", ct);
                if (targetHotel is not null) return targetHotel.Id;
            }
        }
        return full.Booking?.HotelId;
    }

    private async Task NotifyHotelAsync(Case full, Option option, CancellationToken ct)
    {
        var hotelId = await ResolveTargetHotelIdAsync(full, option, ct);
        if (hotelId is null) return;
        var hotelUserId = await cases.FindHotelAccountUserIdAsync(hotelId.Value, ct);
        if (hotelUserId is null) return;

        var now = DateTimeOffset.UtcNow;
        var perksSuffix = option.PerkNames.Count > 0 ? $" Includes: {string.Join(", ", option.PerkNames)}." : "";
        var body = $"A guest has confirmed {OptionTitle(option)} for booking {full.Booking!.ConfirmationNo}.{perksSuffix}";
        await cases.AddNotificationAsync(new Notification
        {
            Id = Guid.NewGuid(), UserId = hotelUserId.Value, Channel = "in_app",
            Type = "guest_selection", Title = "Guest selected a rebooking option",
            Body = body,
            CaseId = full.Id, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
        }, ct);

        var hotelEmail = await cases.FindHotelAccountEmailAsync(hotelId.Value, ct);
        if (string.IsNullOrWhiteSpace(hotelEmail)) return;
        // 酒店账号没有案件对话页可看——把结果直接写进邮件正文，链接指回酒店自己的待办首页，
        // 不指望点"查看"才能知道客人选了什么(见 CaseEmailLinks.BuildHotelHomeLink 的注释)。
        var hotelHomeLink = CaseEmailLinks.BuildHotelHomeLink();
        var htmlBody = EmailTemplate.Build("Guest selected a rebooking option", $"""
            <p>{WebUtility.HtmlEncode(body)}</p>
            {EmailTemplate.Button(hotelHomeLink, "Open your dashboard")}
            """);
        try
        {
            await email.SendEmailAsync(hotelEmail, "Guest selected a rebooking option", $"{body}\n\nOpen your dashboard: {hotelHomeLink}", ct, htmlBody);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to send guest-selection email to {Email}", hotelEmail);
        }
    }

    /// <summary>客人对还在 pending 的 defer 方案点了 P7 确认、而原酒店的 H1 询单也还在 pending 时用这条：
    /// 提醒酒店"客人已经拍板，请尽快响应你待办里的那条请求"。跟 NotifyHotelAsync 分开维护——
    /// 那条的文案读起来像一件新的待办(酒店端 H2 卡)，这条明确指向已有请求，不再制造第二张卡。</summary>
    private async Task NotifyHotelOfGuestCommitmentAsync(Case full, Option option, CancellationToken ct)
    {
        var hotelId = await ResolveTargetHotelIdAsync(full, option, ct);
        if (hotelId is null) return;
        var hotelUserId = await cases.FindHotelAccountUserIdAsync(hotelId.Value, ct);
        if (hotelUserId is null) return;

        var now = DateTimeOffset.UtcNow;
        var title = "Guest confirmed the deferral — awaiting your response";
        var body = $"The guest has confirmed the deferral for booking {full.Booking!.ConfirmationNo}. Please respond to the pending request in your to-dos.";
        await cases.AddNotificationAsync(new Notification
        {
            Id = Guid.NewGuid(), UserId = hotelUserId.Value, Channel = "in_app",
            Type = "guest_selection", Title = title, Body = body,
            CaseId = full.Id, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
        }, ct);

        var hotelEmail = await cases.FindHotelAccountEmailAsync(hotelId.Value, ct);
        if (string.IsNullOrWhiteSpace(hotelEmail)) return;
        var hotelHomeLink = CaseEmailLinks.BuildHotelHomeLink();
        var htmlBody = EmailTemplate.Build(title, $"""
            <p>{WebUtility.HtmlEncode(body)}</p>
            {EmailTemplate.Button(hotelHomeLink, "Open your dashboard")}
            """);
        try
        {
            await email.SendEmailAsync(hotelEmail, title, $"{body}\n\nOpen your dashboard: {hotelHomeLink}", ct, htmlBody);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to send guest-commitment email to {Email}", hotelEmail);
        }
    }

    /// <summary>改订生效后如果客人最终去了别家，原酒店(H1 那次被问过延期、之后再没收到任何消息的那家)
    /// 得单独告诉一声"这单不用你了"，不然它可能还在按原计划给这间房留位。</summary>
    private async Task NotifyOriginalHotelReleasedAsync(Case full, Guid originalHotelId, Booking booking, CancellationToken ct)
    {
        var hotelUserId = await cases.FindHotelAccountUserIdAsync(originalHotelId, ct);
        if (hotelUserId is null) return;

        var now = DateTimeOffset.UtcNow;
        var body = $"The guest for booking {booking.ConfirmationNo} has moved to another hotel — you no longer need to hold this room.";
        await cases.AddNotificationAsync(new Notification
        {
            Id = Guid.NewGuid(), UserId = hotelUserId.Value, Channel = "in_app",
            Type = "booking_released", Title = "Booking moved to another hotel",
            Body = body, CaseId = full.Id, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
        }, ct);

        var hotelEmail = await cases.FindHotelAccountEmailAsync(originalHotelId, ct);
        if (string.IsNullOrWhiteSpace(hotelEmail)) return;
        var hotelHomeLink = CaseEmailLinks.BuildHotelHomeLink();
        var htmlBody = EmailTemplate.Build("Booking moved to another hotel", $"""
            <p>{WebUtility.HtmlEncode(body)}</p>
            {EmailTemplate.Button(hotelHomeLink, "Open your dashboard")}
            """);
        try
        {
            await email.SendEmailAsync(hotelEmail, "Booking moved to another hotel", $"{body}\n\nOpen your dashboard: {hotelHomeLink}", ct, htmlBody);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to send booking-released email to {Email}", hotelEmail);
        }
    }

    /// <summary>客人自己点 P7 确认、方案还没生效(等酒店确认)时的回执邮件——之前只通知了酒店，
    /// 客人这边只在页面上看一眼提交结果，关掉页面就没有任何留痕。</summary>
    private async Task NotifyGuestSelectionSubmittedAsync(Case full, Option option, CancellationToken ct)
    {
        var guest = await users.FindByIdAsync(full.Booking!.GuestUserId, ct);
        if (guest is null) return;

        var body = $"We've submitted your selection ({OptionTitle(option)}) for booking {full.Booking.ConfirmationNo} to the hotel. We'll update you as soon as they confirm.";
        var caseLink = CaseEmailLinks.BuildCaseLink(full.Id);
        var htmlBody = EmailTemplate.Build("Your selection has been submitted", $"""
            <p>{WebUtility.HtmlEncode(body)}</p>
            {EmailTemplate.Button(caseLink, "View this case")}
            """);
        try
        {
            await email.SendEmailAsync(guest.Email, "Your selection has been submitted", $"{body}\n\nView this case: {caseLink}", ct, htmlBody);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to send selection-submitted email to {Email}", guest.Email);
        }
    }

    private async Task EscalateAsync(Case full, string reason, CancellationToken ct)
    {
        if (!full.AssigneeCoordinatorId.HasValue) return;
        var now = DateTimeOffset.UtcNow;
        await cases.AddNotificationAsync(new Notification
        {
            Id = Guid.NewGuid(), UserId = full.AssigneeCoordinatorId.Value, Channel = "in_app",
            Type = "escalation", Title = "Case needs human attention", Body = reason,
            CaseId = full.Id, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
        }, ct);
        await cases.SaveChangesAsync(ct);
    }

    public async Task<PolicySummaryDto> GetPolicySummaryAsync(Guid caseId, Guid optionId, Guid userId, string userRole, CancellationToken ct = default)
    {
        var c = await LoadAuthorizedCaseAsync(cases, caseId, userId, userRole, ct);
        var option = await cases.FindOptionAsync(optionId, caseId, ct) ?? throw new CaseNotFoundException();

        string? excerpt = null;
        string? docName = null;
        int? docVersion = null;

        var hotelId = c.Booking?.HotelId;
        if (hotelId.HasValue)
        {
            var hotelPolicy = await hotelRepo.GetActiveRefundPolicyAsync(hotelId.Value, ct);
            if (hotelPolicy is not null)
            {
                var keyword = option.OptionType switch
                {
                    "cancel" => "refund",
                    "defer" => "deferral due to a disruption",
                    _ => "price difference",
                };
                excerpt = hotelPolicy.Content.Split("\n## ")
                    .FirstOrDefault(s => s.Contains(keyword, StringComparison.OrdinalIgnoreCase))
                    ?.Trim()
                    ?? hotelPolicy.Content.Trim();
                docName = $"Hotel policy: {c.Booking?.Hotel?.Name}";
                docVersion = null;
            }
        }

        if (excerpt is null)
        {
            var docs = await ragRepository.GetDefaultDocumentsAsync(ct);
            var policyDoc = docs.FirstOrDefault(d => d.Name.Contains("policy", StringComparison.OrdinalIgnoreCase)
                || d.Name.Contains("政策", StringComparison.OrdinalIgnoreCase));
            if (policyDoc is not null)
            {
                var keyword = option.OptionType switch
                {
                    "cancel" => "refund",
                    "defer" => "deferral due to a disruption",
                    _ => "price difference",
                };
                excerpt = policyDoc.Content.Split("\n## ")
                    .FirstOrDefault(s => s.Contains(keyword, StringComparison.OrdinalIgnoreCase))
                    ?.Trim();
                docName = policyDoc.Name;
                docVersion = policyDoc.Version;
            }
        }

        return new PolicySummaryDto(excerpt, docName, docVersion, option.PayloadJson);
    }
}
