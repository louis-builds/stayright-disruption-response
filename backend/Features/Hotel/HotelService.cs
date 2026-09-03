using System.Text.Json;
using Microsoft.AspNetCore.Http;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Features.Coordinator;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.HotelPortal;

public class HotelService(IHotelRepository repo, ICaseService caseService, IOptionsAdminService optionsAdmin, RefundPolicyRuleExtractor ruleExtractor) : IHotelService
{
    // ponytail: 酒店响应超时阈值先写死 6 小时,没有单独配置项。
    private static readonly TimeSpan OverdueThreshold = TimeSpan.FromHours(6);

    private async Task<Guid> RequireHotelIdAsync(Guid hotelUserId, CancellationToken ct) =>
        await repo.FindHotelIdForUserAsync(hotelUserId, ct) ?? throw new HotelNotFoundException();

    private static InquiryItemDto ToDto(Inquiry i, HashSet<Guid> returningGuestIds, HashSet<Guid> highValueGuestIds, bool guestCommitted)
    {
        var now = DateTimeOffset.UtcNow;
        var guestId = i.Case?.Booking?.GuestUserId;
        var finalOutcome = i.Case?.Status == "closed"
            ? (i.Case.Booking?.HotelId == i.HotelId ? "stayed" : "moved")
            : null;

        // 跟 OptionsAdminService.BuildDraftOptionsAsync 的 defer 分支、CaseService.ExecuteOptionAsync
        // 同一套规则(比原定入住日期晚3天、保持原住宿晚数，基准是原 check-in 不是"今天")——
        // 三处改动一处记得改另外两处，不然预览和实际生效日期会对不上。
        DateOnly? proposedCheckIn = null, proposedCheckOut = null;
        if (i.Case?.Booking is { } booking)
        {
            var nights = Math.Max(booking.CheckOut.DayNumber - booking.CheckIn.DayNumber, 1);
            proposedCheckIn = booking.CheckIn.AddDays(3);
            proposedCheckOut = proposedCheckIn.Value.AddDays(nights);
        }

        return new InquiryItemDto(
            i.Id, i.CaseId, i.Case?.Booking?.ConfirmationNo ?? "", i.Case?.Booking?.GuestUser?.Nickname ?? "",
            i.Case?.Disruption?.Title ?? "", i.Case?.Booking?.CheckIn ?? default, i.Case?.Booking?.CheckOut ?? default,
            i.Case?.Booking?.RoomType?.Name ?? "", i.Status, i.RequestedAt, now - i.RequestedAt,
            i.Status == "pending" && now - i.RequestedAt > OverdueThreshold,
            guestId.HasValue && returningGuestIds.Contains(guestId.Value),
            guestId.HasValue && highValueGuestIds.Contains(guestId.Value),
            i.RespondedAt, i.RejectReason, finalOutcome, proposedCheckIn, proposedCheckOut, guestCommitted);
    }

    public async Task<List<InquiryItemDto>> ListInquiriesAsync(Guid hotelUserId, string? status, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var list = await repo.ListInquiriesAsync(hotelId, status, ct);
        var guestIds = list.Where(i => i.Case?.Booking is not null).Select(i => i.Case!.Booking!.GuestUserId);
        var returning = await repo.GetReturningGuestIdsAsync(guestIds, hotelId, ct);
        var highValue = await repo.GetPlatformHighValueGuestIdsAsync(guestIds, ct);
        var committed = await repo.GetCaseIdsWithCommittedDeferAsync(list.Select(i => i.CaseId), ct);
        return [.. list.Select(i => ToDto(i, returning, highValue, committed.Contains(i.CaseId)))];
    }

    public async Task ConfirmInquiryAsync(Guid hotelUserId, Guid inquiryId, ConfirmInquiryRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var inquiry = await repo.FindInquiryAsync(inquiryId, hotelId, ct) ?? throw new HotelItemNotFoundException();
        if (inquiry.Status != "pending") return;

        inquiry.Status = "accepted";
        inquiry.RespondedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);

        // 自动闭环:酒店确认后案件可能还没有任何方案草稿(没有协调员手动开过P3),
        // 这里补一次自动生成,客人才能在P4/P5马上看到可用选项,不用等协调员插手。
        await optionsAdmin.GetOptionsAsync(inquiry.CaseId, ct);

        // 询单对应这个案件里"延期保留原酒店"的选项:酒店确认了,选项才真正可选/生效。
        var deferOption = await repo.FindOptionByCaseAndTypeAsync(inquiry.CaseId, "defer", ct);
        if (deferOption is not null) await caseService.ResolveOptionAvailableAsync(inquiry.CaseId, deferOption.Id, ct);

        // 通知客人这件事不能挂在"刚好有没有 defer Option"上——酒店用"+ Offer custom option"个性化响应时
        // 就没有 defer Option，上面那条分支不会走，之前这里就是这么漏掉通知的，独立无条件调一次。
        await caseService.NotifyGuestOfInquiryDecisionAsync(inquiry.CaseId, true, null, ct);
    }

    public async Task RejectInquiryAsync(Guid hotelUserId, Guid inquiryId, RejectInquiryRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var inquiry = await repo.FindInquiryAsync(inquiryId, hotelId, ct) ?? throw new HotelItemNotFoundException();
        if (inquiry.Status != "pending") return;

        inquiry.Status = "rejected";
        inquiry.RejectReason = request.Reason;
        inquiry.RespondedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);

        await optionsAdmin.GetOptionsAsync(inquiry.CaseId, ct);
        var deferOption = await repo.FindOptionByCaseAndTypeAsync(inquiry.CaseId, "defer", ct);
        if (deferOption is not null) await optionsAdmin.MarkUnavailableAsync(inquiry.CaseId, deferOption.Id, $"Hotel declined: {request.Reason}", ct);

        await caseService.NotifyGuestOfInquiryDecisionAsync(inquiry.CaseId, false, request.Reason, ct);
    }

    private static SelectedOptionItemDto ToDto(Option o, HashSet<Guid> returningGuestIds, HashSet<Guid> highValueGuestIds)
    {
        var guestId = o.Case?.Booking?.GuestUserId;
        return new(
            o.Id, o.CaseId, o.Case?.Booking?.ConfirmationNo ?? "", o.Case?.Booking?.GuestUser?.Nickname ?? "",
            o.OptionType, o.PayloadJson, o.UpdatedAt, o.CustomTitle, o.PerkNames,
            guestId.HasValue && returningGuestIds.Contains(guestId.Value),
            guestId.HasValue && highValueGuestIds.Contains(guestId.Value),
            o.Availability, o.UnavailableReason);
    }

    private async Task<bool> OptionTargetsHotelAsync(Option option, Guid hotelId, CancellationToken ct)
    {
        if (option.OptionType == "defer") return option.Case?.Booking?.HotelId == hotelId;
        if (option.OptionType != "alternate") return false;

        using var payload = System.Text.Json.JsonDocument.Parse(option.PayloadJson);
        if (!payload.RootElement.TryGetProperty("hotel", out var hotelNameEl)) return false;
        var targetHotel = await repo.FindHotelByNameAsync(hotelNameEl.GetString() ?? "", ct);
        return targetHotel?.Id == hotelId;
    }

    public async Task<List<SelectedOptionItemDto>> ListSelectedOptionsAsync(Guid hotelUserId, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var all = await repo.ListSelectedPendingOptionsAsync(ct);
        var mine = new List<Option>();
        foreach (var o in all)
            if (await OptionTargetsHotelAsync(o, hotelId, ct)) mine.Add(o);
        var guestIds = mine.Where(o => o.Case?.Booking is not null).Select(o => o.Case!.Booking!.GuestUserId);
        var returning = await repo.GetReturningGuestIdsAsync(guestIds, hotelId, ct);
        var highValue = await repo.GetPlatformHighValueGuestIdsAsync(guestIds, ct);
        return [.. mine.Select(o => ToDto(o, returning, highValue))];
    }

    public async Task<List<SelectedOptionItemDto>> ListResolvedOptionsHistoryAsync(Guid hotelUserId, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var all = await repo.ListResolvedOptionsForHotelHistoryAsync(hotelId, ct);
        var mine = new List<Option>();
        foreach (var o in all)
            if (await OptionTargetsHotelAsync(o, hotelId, ct)) mine.Add(o);
        var guestIds = mine.Where(o => o.Case?.Booking is not null).Select(o => o.Case!.Booking!.GuestUserId);
        var returning = await repo.GetReturningGuestIdsAsync(guestIds, hotelId, ct);
        var highValue = await repo.GetPlatformHighValueGuestIdsAsync(guestIds, ct);
        return [.. mine.Select(o => ToDto(o, returning, highValue))];
    }

    public async Task ConfirmOptionAsync(Guid hotelUserId, Guid optionId, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var option = await repo.FindOptionAsync(optionId, ct) ?? throw new HotelItemNotFoundException();
        if (!await OptionTargetsHotelAsync(option, hotelId, ct)) throw new HotelItemNotFoundException();
        if (option.Case?.Status == "closed") throw new CaseClosedException();

        await optionsAdmin.GetOptionsAsync(option.CaseId, ct);
        await caseService.ResolveOptionAvailableAsync(option.CaseId, optionId, ct);
        // 方案真的执行了的话，ExecuteOptionAsync 里面已经闭环过 pending 询单；这里兜的是"解锁但
        // 没执行"的分支(客人还没点 P7 确认)——酒店已经点头，同一件事的 H1 询单也该一并落定。
        await ClosePendingInquiriesAsync(option.CaseId, "accepted", null, ct);
    }

    public async Task RejectOptionAsync(Guid hotelUserId, Guid optionId, RejectInquiryRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var option = await repo.FindOptionAsync(optionId, ct) ?? throw new HotelItemNotFoundException();
        if (!await OptionTargetsHotelAsync(option, hotelId, ct)) throw new HotelItemNotFoundException();
        if (option.Case?.Status == "closed") throw new CaseClosedException();

        await optionsAdmin.GetOptionsAsync(option.CaseId, ct);
        await optionsAdmin.MarkUnavailableAsync(option.CaseId, optionId, $"Hotel declined: {request.Reason}", ct);
        await ClosePendingInquiriesAsync(option.CaseId, "rejected", $"Hotel declined: {request.Reason}", ct);
    }

    // H2 卡(客人已选方案)被酒店确认/拒绝后，同一件事的 H1 询单若还停在 pending 跟着落定。正常情况
    // 下这张 H2 卡能出现就不该再有 pending 的 H1(见 HotelRepository.ListSelectedPendingOptionsAsync 的
    // 过滤)，这段是对旧数据/并发窗口的保底——不让待办里留下客人早就处理完、却永远关不掉的卡。
    private async Task ClosePendingInquiriesAsync(Guid caseId, string status, string? rejectReason, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var inquiry in await repo.ListPendingInquiriesAsync(caseId, ct))
        {
            inquiry.Status = status;
            inquiry.RejectReason = rejectReason;
            inquiry.RespondedAt = now;
            inquiry.UpdatedAt = now;
        }
        await repo.SaveChangesAsync(ct);
    }

    public async Task<HotelProfileDto> GetProfileAsync(Guid hotelUserId, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var hotel = await repo.FindHotelWithRoomTypesAsync(hotelId, ct) ?? throw new HotelNotFoundException();
        var perks = await repo.ListPerksAsync(hotelId, ct);
        return ToProfileDto(hotel, perks);
    }

    private static HotelProfileDto ToProfileDto(TravelDisruptionAgent.Api.Infrastructure.Data.Entities.Hotel h, List<HotelPerk> perks) => new(
        h.Id, h.Name, h.Address, h.Lat, h.Lng, h.ImageUrls, h.PrimaryImageIndex,
        [.. h.RoomTypes.Select(r => new RoomTypeDto(r.Id, r.Name, r.Description, r.Amenities, r.Capacity, r.PriceAmount, r.Currency, r.ImageUrls))],
        [.. perks.Select(p => new HotelPerkDto(p.Id, p.Name))]);

    public async Task UpdateProfileAsync(Guid hotelUserId, UpdateHotelProfileRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var hotel = await repo.FindHotelWithRoomTypesAsync(hotelId, ct) ?? throw new HotelNotFoundException();
        hotel.Name = request.Name;
        hotel.Address = request.Address;
        hotel.Lat = request.Lat;
        hotel.Lng = request.Lng;
        hotel.ImageUrls = request.ImageUrls;
        hotel.PrimaryImageIndex = request.PrimaryImageIndex;
        hotel.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
    }

    public async Task<RoomTypeDto> AddRoomTypeAsync(Guid hotelUserId, UpsertRoomTypeRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var now = DateTimeOffset.UtcNow;
        var roomType = new RoomType
        {
            Id = Guid.NewGuid(), HotelId = hotelId, Name = request.Name, Description = request.Description,
            Amenities = request.Amenities, Capacity = request.Capacity, PriceAmount = request.PriceAmount,
            Currency = request.Currency, ImageUrls = request.ImageUrls, CreatedAt = now, UpdatedAt = now,
        };
        await repo.AddRoomTypeAsync(roomType, ct);
        await repo.SaveChangesAsync(ct);
        return new RoomTypeDto(roomType.Id, roomType.Name, roomType.Description, roomType.Amenities, roomType.Capacity, roomType.PriceAmount, roomType.Currency, roomType.ImageUrls);
    }

    public async Task UpdateRoomTypeAsync(Guid hotelUserId, Guid roomTypeId, UpsertRoomTypeRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var roomType = await repo.FindRoomTypeAsync(roomTypeId, hotelId, ct) ?? throw new HotelItemNotFoundException();
        roomType.Name = request.Name;
        roomType.Description = request.Description;
        roomType.Amenities = request.Amenities;
        roomType.Capacity = request.Capacity;
        roomType.PriceAmount = request.PriceAmount;
        roomType.Currency = request.Currency;
        roomType.ImageUrls = request.ImageUrls;
        roomType.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
    }

    public async Task DeleteRoomTypeAsync(Guid hotelUserId, Guid roomTypeId, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var roomType = await repo.FindRoomTypeAsync(roomTypeId, hotelId, ct) ?? throw new HotelItemNotFoundException();
        await repo.RemoveRoomTypeAsync(roomType, ct);
        await repo.SaveChangesAsync(ct);
    }

    public async Task<HotelPerkDto> AddPerkAsync(Guid hotelUserId, AddHotelPerkRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var perk = new HotelPerk { Id = Guid.NewGuid(), HotelId = hotelId, Name = request.Name, CreatedAt = DateTimeOffset.UtcNow };
        await repo.AddPerkAsync(perk, ct);
        await repo.SaveChangesAsync(ct);
        return new HotelPerkDto(perk.Id, perk.Name);
    }

    public async Task<HotelRefundPolicyDto?> GetRefundPolicyAsync(Guid hotelUserId, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var policy = await repo.GetActiveRefundPolicyAsync(hotelId, ct);
        return policy is null ? null : ToRefundPolicyDto(policy);
    }

    public async Task<HotelRefundPolicyDto> UpsertRefundPolicyAsync(Guid hotelUserId, UpsertHotelRefundPolicyRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        RefundPolicyParser.Validate(request.StructuredRulesJson);
        var policy = await repo.UpsertRefundPolicyAsync(hotelId, await WithAutoExtractedRulesAsync(request, ct), ct);
        return ToRefundPolicyDto(policy);
    }

    public async Task<HotelRefundPolicyDto> UploadRefundPolicyFileAsync(Guid hotelUserId, IFormFile file, UploadRefundPolicyFileRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        RefundPolicyParser.Validate(request.StructuredRulesJson);

        await using var stream = file.OpenReadStream();
        var content = PolicyDocumentExtractor.Extract(stream, file.FileName, file.Length);

        var upsertRequest = new UpsertHotelRefundPolicyRequest(
            content, request.StructuredRulesJson, request.EffectiveFrom, request.EffectiveUntil, true);
        var policy = await repo.UpsertRefundPolicyAsync(hotelId, await WithAutoExtractedRulesAsync(upsertRequest, ct), ct);
        return ToRefundPolicyDto(policy);
    }

    /// <summary>酒店端只维护政策自由文本，结构化规则（退款金额怎么算）在保存时由 AI 从文本自动提取。
    /// 调用方显式传了 StructuredRulesJson 时尊重调用方，不覆盖。文本为空或提取不出任何字段时
    /// 存 null，CalculateRefund 会走默认 10%+0——与没配政策时的行为一致。</summary>
    private async Task<UpsertHotelRefundPolicyRequest> WithAutoExtractedRulesAsync(UpsertHotelRefundPolicyRequest request, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(request.StructuredRulesJson)) return request;
        if (string.IsNullOrWhiteSpace(request.Content)) return request;

        var extracted = await ruleExtractor.ExtractAsync(request.Content, ct);
        var rulesJson = JsonSerializer.Serialize(new
        {
            freeCancellationHours = extracted.FreeCancellationHours,
            cancellationFeePercent = extracted.CancellationFeePercent,
            cancellationFeeFixed = extracted.CancellationFeeFixed,
            currency = extracted.Currency ?? "NZD",
        });
        return request with { StructuredRulesJson = rulesJson };
    }

    public async Task<ExtractedRefundRulesDto> ExtractRefundRulesAsync(Guid hotelUserId, ExtractRefundRulesRequest request, CancellationToken ct = default)
    {
        await RequireHotelIdAsync(hotelUserId, ct);
        return await ruleExtractor.ExtractAsync(request.Content, ct);
    }

    private static HotelRefundPolicyDto ToRefundPolicyDto(HotelRefundPolicy p) => new(
        p.Id, p.Content, p.StructuredRulesJson, p.EffectiveFrom, p.EffectiveUntil, p.IsActive, p.UpdatedAt);

    public async Task DeletePerkAsync(Guid hotelUserId, Guid perkId, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var perk = await repo.FindPerkAsync(perkId, hotelId, ct) ?? throw new HotelItemNotFoundException();
        await repo.RemovePerkAsync(perk, ct);
        await repo.SaveChangesAsync(ct);
    }

    public async Task SetOptionPerksAsync(Guid hotelUserId, Guid optionId, SetOptionPerksRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var option = await repo.FindOptionAsync(optionId, ct) ?? throw new HotelItemNotFoundException();
        if (!await OptionTargetsHotelAsync(option, hotelId, ct)) throw new HotelItemNotFoundException();

        option.PerkNames = request.PerkNames;
        option.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
    }

    // 判定这家酒店跟这个案件到底有没有关系:要么订单本来就订在这家酒店(H1 场景),
    // 要么案件上有个 alternate 方案是想把客人改住到这家酒店(H2 场景，订单本身的 hotel_id
    // 还没变——只有客人真正确认执行之后才会改)。少了后半段的话，被指定为候补酒店的一方
    // 明明能在自己的"待办"队列里看到这条 H2 请求，点"+ Offer custom option"却会 404，
    // 而且前端还不显示任何报错，用户完全不知道发生了什么(一并修的问题，见 P20 测试记录)。
    private async Task<bool> IsHotelInvolvedInCaseAsync(Case c, Guid hotelId, CancellationToken ct)
    {
        if (c.Booking?.HotelId == hotelId) return true;
        foreach (var o in await repo.ListOptionsForCaseAsync(c.Id, ct))
            if (await OptionTargetsHotelAsync(o, hotelId, ct)) return true;
        return false;
    }

    public async Task<SelectedOptionItemDto> CreateCustomOptionAsync(Guid hotelUserId, Guid caseId, CreateCustomOptionRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var full = await repo.FindCaseWithBookingAsync(caseId, ct) ?? throw new HotelItemNotFoundException();
        if (full.Booking is null) throw new HotelItemNotFoundException();
        if (!await IsHotelInvolvedInCaseAsync(full, hotelId, ct)) throw new HotelItemNotFoundException();

        var now = DateTimeOffset.UtcNow;
        // Locked=true: 这是酒店手动加的方案，不是 P3 的 AI 草稿，协调员点"Regenerate unlocked options"
        // 不该把它清掉——那个操作只重建标准三类型草稿，锁住的选项本来就跳过。
        var option = new Option
        {
            Id = Guid.NewGuid(), CaseId = caseId, OptionType = "custom", PayloadJson = "{}",
            Availability = "available", CustomTitle = request.Title, PerkNames = request.PerkNames,
            Locked = true, CreatedAt = now, UpdatedAt = now,
        };
        await repo.AddOptionAsync(option, ct);
        await repo.SaveChangesAsync(ct);
        // 酒店走个性化响应这条路时不经过 Inquiry 确认那套自动补全逻辑，客人这时也该同时看到
        // 标准的 defer/alternate/cancel 候选，不用等协调员另外手动开后台才生成。
        await optionsAdmin.GetOptionsAsync(caseId, ct);
        var returning = await repo.GetReturningGuestIdsAsync([full.Booking.GuestUserId], hotelId, ct);
        var highValue = await repo.GetPlatformHighValueGuestIdsAsync([full.Booking.GuestUserId], ct);
        return new SelectedOptionItemDto(
            option.Id, caseId, full.Booking.ConfirmationNo, full.Booking.GuestUser?.Nickname ?? "",
            option.OptionType, option.PayloadJson, option.UpdatedAt, option.CustomTitle, option.PerkNames,
            returning.Contains(full.Booking.GuestUserId), highValue.Contains(full.Booking.GuestUserId),
            option.Availability, option.UnavailableReason);
    }
}
