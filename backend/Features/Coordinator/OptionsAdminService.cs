using System.Text.Json;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Features.HotelPortal;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Email;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

// ponytail: 三选项的金额一律从酒店/房型表规则计算,不接 Gemini 生成数字(政策要求"不用文档搜索来查价",
// 延伸到不用 AI 编数字);AI 预填目前体现为"自动生成结构化字段草稿,协调员改表单"这一步,
// 真正调用 Gemini 润色话术留作后续增强,不在本任务强绑定,避免把金额正确性绑定到网络可用性上。
public class OptionsAdminService(IOptionsAdminRepository repo, IEmailService email, IHotelRepository hotelRepo)
    : IOptionsAdminService
{
    private static readonly string[] CanonicalTypes = ["defer", "alternate", "cancel"];

    private static AdminOptionDto ToDto(Option o) =>
        new(o.Id, o.OptionType, o.Availability, o.Selected, o.Locked, o.UnavailableReason, o.PayloadJson, o.CreatedAt, o.CustomTitle, o.PerkNames,
            o.CoordinatorVisibilityOverride);

    private static double HaversineKm(double lat1, double lng1, double lat2, double lng2)
    {
        var r = 6371.0;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
        return r * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private async Task<List<Option>> BuildDraftOptionsAsync(Case c, IEnumerable<string> typesToBuild, CancellationToken ct)
    {
        var booking = c.Booking!;
        var nights = Math.Max(booking.CheckOut.DayNumber - booking.CheckIn.DayNumber, 1);
        var now = DateTimeOffset.UtcNow;
        var built = new List<Option>();
        var types = typesToBuild.ToHashSet();

        if (types.Contains("defer"))
        {
            var deferPayload = JsonSerializer.Serialize(new
            {
                new_check_in_offset_days = 3,
                new_check_out_offset_days = 3 + nights,
                fee_diff = 0m,
                currency = booking.Currency,
            });
            built.Add(new Option
            {
                Id = Guid.NewGuid(), CaseId = c.Id, OptionType = "defer", PayloadJson = deferPayload,
                Availability = "pending", CreatedAt = now, UpdatedAt = now,
            });
        }

        if (types.Contains("alternate"))
        {
            var alt = await repo.FindCheapestAlternateAsync(booking.HotelId, ct);
            if (alt is not null)
            {
                var (hotel, roomType) = alt.Value;
                var originalNightly = booking.RoomType?.PriceAmount ?? booking.TotalAmount / nights;
                var feeDiff = Math.Round((roomType.PriceAmount - originalNightly) * nights, 2);
                var distanceKm = booking.Hotel is not null
                    ? Math.Round(HaversineKm(booking.Hotel.Lat, booking.Hotel.Lng, hotel.Lat, hotel.Lng), 0)
                    : (double?)null;
                var altPayload = JsonSerializer.Serialize(new
                {
                    hotel = hotel.Name,
                    room_type = roomType.Name,
                    fee_diff = feeDiff,
                    currency = booking.Currency,
                    distance_km = distanceKm,
                });
                built.Add(new Option
                {
                    Id = Guid.NewGuid(), CaseId = c.Id, OptionType = "alternate", PayloadJson = altPayload,
                    Availability = "pending", CreatedAt = now, UpdatedAt = now,
                });
            }
        }

        if (types.Contains("cancel"))
        {
            var policy = await hotelRepo.GetActiveRefundPolicyAsync(booking.HotelId, ct);
            var rules = RefundPolicyParser.Parse(policy?.StructuredRulesJson);
            var (cancellationFee, refundAmount) = RefundPolicyParser.CalculateRefund(booking.TotalAmount, rules);
            var cancelPayload = JsonSerializer.Serialize(new
            {
                refund_amount = refundAmount,
                cancellation_fee = cancellationFee,
                currency = booking.Currency,
                eta_business_days = 5,
            });
            built.Add(new Option
            {
                Id = Guid.NewGuid(), CaseId = c.Id, OptionType = "cancel", PayloadJson = cancelPayload,
                Availability = "available", CreatedAt = now, UpdatedAt = now,
            });
        }

        return built;
    }

    public async Task<List<AdminOptionDto>> GetOptionsAsync(Guid caseId, CancellationToken ct = default)
    {
        var c = await repo.FindCaseWithContextAsync(caseId, ct) ?? throw new CaseNotFoundException();
        var options = await repo.ListOptionsAsync(caseId, ct);

        // 按"缺哪个类型补哪个"而不是"完全没有才生成"——酒店走个性化响应(custom)会先造出一条
        // 记录，这时案件已经不是空的了，但标准三类型还是一个都没有，得照样补上。
        var existingTypes = options.Select(o => o.OptionType).ToHashSet();
        var missingTypes = CanonicalTypes.Where(t => !existingTypes.Contains(t)).ToList();
        if (missingTypes.Count > 0)
        {
            var drafts = await BuildDraftOptionsAsync(c, missingTypes, ct);
            foreach (var d in drafts) await repo.AddOptionAsync(d, ct);
            await repo.SaveChangesAsync(ct);
            options = [.. options, .. drafts];
        }

        return [.. options.Select(ToDto)];
    }

    public async Task UpdatePayloadAsync(Guid caseId, Guid optionId, Dictionary<string, object> payload, CancellationToken ct = default)
    {
        if (await repo.FindCaseStatusAsync(caseId, ct) == "closed") throw new CaseClosedException();
        var o = await repo.FindOptionAsync(optionId, caseId, ct) ?? throw new OptionNotFoundException();
        if (o.Locked) throw new OptionLockedException();
        o.PayloadJson = JsonSerializer.Serialize(payload);
        o.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
    }

    public async Task MarkUnavailableAsync(Guid caseId, Guid optionId, string reason, CancellationToken ct = default)
    {
        if (await repo.FindCaseStatusAsync(caseId, ct) == "closed") throw new CaseClosedException();
        var o = await repo.FindOptionAsync(optionId, caseId, ct) ?? throw new OptionNotFoundException();
        o.Availability = "unavailable";
        o.UnavailableReason = reason;
        o.Selected = false;
        o.UpdatedAt = DateTimeOffset.UtcNow;

        var siblings = await repo.ListOptionsAsync(caseId, ct);
        if (siblings.All(s => s.Availability == "unavailable"))
        {
            var c = await repo.FindCaseWithContextAsync(caseId, ct);
            if (c is not null)
            {
                c.EscalationReason = "无可用候补或全拒方案";
                c.UpdatedAt = DateTimeOffset.UtcNow;
            }
        }
        await repo.SaveChangesAsync(ct);
    }

    public async Task SetGuestVisibilityAsync(Guid caseId, Guid optionId, bool? visible, CancellationToken ct = default)
    {
        var o = await repo.FindOptionAsync(optionId, caseId, ct) ?? throw new OptionNotFoundException();
        o.CoordinatorVisibilityOverride = visible;
        o.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
    }

    public async Task LockAsync(Guid caseId, Guid optionId, Guid actorUserId, CancellationToken ct = default)
    {
        if (await repo.FindCaseStatusAsync(caseId, ct) == "closed") throw new CaseClosedException();
        var o = await repo.FindOptionAsync(optionId, caseId, ct) ?? throw new OptionNotFoundException();
        o.Locked = true;
        o.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.AddLockAuditAsync(new OptionLockAudit
        {
            Id = Guid.NewGuid(), OptionId = optionId, ActorUserId = actorUserId, Action = "lock", CreatedAt = DateTimeOffset.UtcNow,
        }, ct);
        await repo.SaveChangesAsync(ct);
    }

    public async Task UnlockAsync(Guid caseId, Guid optionId, Guid actorUserId, string reason, CancellationToken ct = default)
    {
        if (await repo.FindCaseStatusAsync(caseId, ct) == "closed") throw new CaseClosedException();
        var o = await repo.FindOptionAsync(optionId, caseId, ct) ?? throw new OptionNotFoundException();
        o.Locked = false;
        o.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.AddLockAuditAsync(new OptionLockAudit
        {
            Id = Guid.NewGuid(), OptionId = optionId, ActorUserId = actorUserId, Action = "unlock", Reason = reason, CreatedAt = DateTimeOffset.UtcNow,
        }, ct);
        await repo.SaveChangesAsync(ct);
    }

    public async Task RegenerateAsync(Guid caseId, CancellationToken ct = default)
    {
        var c = await repo.FindCaseWithContextAsync(caseId, ct) ?? throw new CaseNotFoundException();
        if (c.Status == "closed") throw new CaseClosedException();
        var options = await repo.ListOptionsAsync(caseId, ct);
        var lockedTypes = options.Where(o => o.Locked).Select(o => o.OptionType).ToHashSet();
        var toRemove = options.Where(o => !o.Locked).ToList();
        foreach (var o in toRemove) await repo.RemoveOptionAsync(o, ct);

        var typesToBuild = CanonicalTypes.Where(t => !lockedTypes.Contains(t));
        var drafts = await BuildDraftOptionsAsync(c, typesToBuild, ct);
        foreach (var d in drafts) await repo.AddOptionAsync(d, ct);
        await repo.SaveChangesAsync(ct);
    }

    public async Task<PushOptionsResultDto> PushAsync(Guid caseId, CancellationToken ct = default)
    {
        var c = await repo.FindCaseWithContextAsync(caseId, ct) ?? throw new CaseNotFoundException();
        if (c.Status == "closed") throw new CaseClosedException();
        var now = DateTimeOffset.UtcNow;
        var guest = c.Booking?.GuestUser;
        var success = true;

        if (guest is not null)
        {
            try
            {
                var caseLink = CaseEmailLinks.BuildCaseLink(caseId);
                var htmlBody = EmailTemplate.Build("New rebooking options are ready", $"""
                    <p>We've updated the options for your booking affected by {System.Net.WebUtility.HtmlEncode(c.Disruption?.Title)}. Please check your case conversation to review them.</p>
                    {EmailTemplate.Button(caseLink, "View this case")}
                    """);
                await email.SendEmailAsync(guest.Email, "New rebooking options are ready",
                    $"We've updated the options for your booking affected by {c.Disruption?.Title}. Please check your case conversation to review them.\n\nView this case: {caseLink}", ct, htmlBody);
            }
            catch
            {
                success = false;
            }

            await repo.AddNotificationAsync(new Notification
            {
                Id = Guid.NewGuid(), UserId = guest.Id, Channel = "email", Type = "options_pushed",
                Title = "New rebooking options are ready", Body = "A coordinator has updated your rebooking options — please take a look.",
                CaseId = caseId, SentAt = now, Success = success, CreatedAt = now, UpdatedAt = now,
            }, ct);
        }

        await repo.SaveChangesAsync(ct);
        return new PushOptionsResultDto(success, now);
    }
}
