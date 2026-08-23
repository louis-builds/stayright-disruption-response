using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Features.Coordinator;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;

namespace TravelDisruptionAgent.Api.Features.HotelPortal;

public class HotelService(IHotelRepository repo, ICaseService caseService, IOptionsAdminService optionsAdmin) : IHotelService
{
    // ponytail: 酒店响应超时阈值先写死 6 小时,没有单独配置项。
    private static readonly TimeSpan OverdueThreshold = TimeSpan.FromHours(6);

    private async Task<Guid> RequireHotelIdAsync(Guid hotelUserId, CancellationToken ct) =>
        await repo.FindHotelIdForUserAsync(hotelUserId, ct) ?? throw new HotelNotFoundException();

    private static InquiryItemDto ToDto(Inquiry i, HashSet<Guid> highValueGuestIds)
    {
        var now = DateTimeOffset.UtcNow;
        return new InquiryItemDto(
            i.Id, i.CaseId, i.Case?.Booking?.ConfirmationNo ?? "", i.Case?.Booking?.GuestUser?.Nickname ?? "",
            i.Case?.Disruption?.Title ?? "", i.Case?.Booking?.CheckIn ?? default, i.Case?.Booking?.CheckOut ?? default,
            i.Case?.Booking?.RoomType?.Name ?? "", i.Status, i.RequestedAt, now - i.RequestedAt,
            i.Status == "pending" && now - i.RequestedAt > OverdueThreshold,
            i.Case?.Booking is not null && highValueGuestIds.Contains(i.Case.Booking.GuestUserId),
            i.RespondedAt, i.RejectReason);
    }

    public async Task<List<InquiryItemDto>> ListInquiriesAsync(Guid hotelUserId, string? status, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var list = await repo.ListInquiriesAsync(hotelId, status, ct);
        var highValue = await repo.GetHighValueGuestIdsAsync(list.Where(i => i.Case?.Booking is not null).Select(i => i.Case!.Booking!.GuestUserId), ct);
        return [.. list.Select(i => ToDto(i, highValue))];
    }

    public async Task ConfirmInquiryAsync(Guid hotelUserId, Guid inquiryId, ConfirmInquiryRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var inquiry = await repo.FindInquiryAsync(inquiryId, hotelId, ct) ?? throw new HotelItemNotFoundException();

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

        inquiry.Status = "rejected";
        inquiry.RejectReason = request.Reason;
        inquiry.RespondedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);

        await optionsAdmin.GetOptionsAsync(inquiry.CaseId, ct);
        var deferOption = await repo.FindOptionByCaseAndTypeAsync(inquiry.CaseId, "defer", ct);
        if (deferOption is not null) await optionsAdmin.MarkUnavailableAsync(inquiry.CaseId, deferOption.Id, $"Hotel declined: {request.Reason}", ct);

        await caseService.NotifyGuestOfInquiryDecisionAsync(inquiry.CaseId, false, request.Reason, ct);
    }

    private static SelectedOptionItemDto ToDto(Option o, HashSet<Guid> highValueGuestIds) => new(
        o.Id, o.CaseId, o.Case?.Booking?.ConfirmationNo ?? "", o.Case?.Booking?.GuestUser?.Nickname ?? "",
        o.OptionType, o.PayloadJson, o.UpdatedAt, o.CustomTitle, o.PerkNames,
        o.Case?.Booking is not null && highValueGuestIds.Contains(o.Case.Booking.GuestUserId),
        o.Availability, o.UnavailableReason);

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
        var highValue = await repo.GetHighValueGuestIdsAsync(mine.Where(o => o.Case?.Booking is not null).Select(o => o.Case!.Booking!.GuestUserId), ct);
        return [.. mine.Select(o => ToDto(o, highValue))];
    }

    public async Task<List<SelectedOptionItemDto>> ListResolvedOptionsHistoryAsync(Guid hotelUserId, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var all = await repo.ListResolvedOptionsForHotelHistoryAsync(hotelId, ct);
        var mine = new List<Option>();
        foreach (var o in all)
            if (await OptionTargetsHotelAsync(o, hotelId, ct)) mine.Add(o);
        var highValue = await repo.GetHighValueGuestIdsAsync(mine.Where(o => o.Case?.Booking is not null).Select(o => o.Case!.Booking!.GuestUserId), ct);
        return [.. mine.Select(o => ToDto(o, highValue))];
    }

    public async Task ConfirmOptionAsync(Guid hotelUserId, Guid optionId, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var option = await repo.FindOptionAsync(optionId, ct) ?? throw new HotelItemNotFoundException();
        if (!await OptionTargetsHotelAsync(option, hotelId, ct)) throw new HotelItemNotFoundException();
        if (option.Case?.Status == "closed") throw new CaseClosedException();

        await optionsAdmin.GetOptionsAsync(option.CaseId, ct);
        await caseService.ResolveOptionAvailableAsync(option.CaseId, optionId, ct);
    }

    public async Task RejectOptionAsync(Guid hotelUserId, Guid optionId, RejectInquiryRequest request, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var option = await repo.FindOptionAsync(optionId, ct) ?? throw new HotelItemNotFoundException();
        if (!await OptionTargetsHotelAsync(option, hotelId, ct)) throw new HotelItemNotFoundException();
        if (option.Case?.Status == "closed") throw new CaseClosedException();

        await optionsAdmin.GetOptionsAsync(option.CaseId, ct);
        await optionsAdmin.MarkUnavailableAsync(option.CaseId, optionId, $"Hotel declined: {request.Reason}", ct);
    }

    public async Task<HotelProfileDto> GetProfileAsync(Guid hotelUserId, CancellationToken ct = default)
    {
        var hotelId = await RequireHotelIdAsync(hotelUserId, ct);
        var hotel = await repo.FindHotelWithRoomTypesAsync(hotelId, ct) ?? throw new HotelNotFoundException();
        var perks = await repo.ListPerksAsync(hotelId, ct);
        return ToProfileDto(hotel, perks);
    }

    private static HotelProfileDto ToProfileDto(TravelDisruptionAgent.Api.Infrastructure.Data.Entities.Hotel h, List<HotelPerk> perks) => new(
        h.Id, h.Name, h.Address, h.Lat, h.Lng,
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
        var highValue = await repo.GetHighValueGuestIdsAsync([full.Booking.GuestUserId], ct);
        return new SelectedOptionItemDto(
            option.Id, caseId, full.Booking.ConfirmationNo, full.Booking.GuestUser?.Nickname ?? "",
            option.OptionType, option.PayloadJson, option.UpdatedAt, option.CustomTitle, option.PerkNames,
            highValue.Contains(full.Booking.GuestUserId), option.Availability, option.UnavailableReason);
    }
}
