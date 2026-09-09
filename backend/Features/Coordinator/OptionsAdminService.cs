using System.Text.Json;
using TravelDisruptionAgent.Api.Features.Bookings;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Features.HotelPortal;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Email;

namespace TravelDisruptionAgent.Api.Features.Coordinator;

// ponytail: 三选项的金额一律从酒店/房型表规则计算,不接 Gemini 生成数字(政策要求"不用文档搜索来查价",
// 延伸到不用 AI 编数字);AI 预填目前体现为"自动生成结构化字段草稿,协调员改表单"这一步,
// 真正调用 Gemini 润色话术留作后续增强,不在本任务强绑定,避免把金额正确性绑定到网络可用性上。
public class OptionsAdminService(IOptionsAdminRepository repo, IBookingRepository bookingRepo, IEmailService email, IHotelRepository hotelRepo)
    : IOptionsAdminService
{
    private static readonly string[] CanonicalTypes = ["defer", "alternate", "cancel"];

    private static AdminOptionDto ToDto(Option o) =>
        new(o.Id, o.OptionType, o.Availability, o.Selected, o.Locked, o.UnavailableReason, o.PayloadJson, o.CreatedAt, o.CustomTitle, o.PerkNames,
            o.CoordinatorVisibilityOverride, o.ExecutionRequestedAt);

    private static double HaversineKm(double lat1, double lng1, double lat2, double lng2)
    {
        var r = 6371.0;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
        return r * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    // ponytail: 权重是拍脑袋定的启发式(没有真实客人反馈数据可标定)——距离按公里数直接算分,
    // 容量差一档扣 5 分,每有一个共同 amenity 减 3 分,客人自己以前住过这家酒店减 20 分(强偏好信号),
    // 价格只占很小的尾巴项当打平时的 tie-breaker。等有真实选择数据了再回来调这几个数字。
    private static double ScoreAlternate(Hotel candidateHotel, RoomType candidateRoom, Hotel? originalHotel,
        RoomType? originalRoom, HashSet<Guid> guestPreviousHotelIds)
    {
        var distanceKm = originalHotel is null
            ? 0
            : HaversineKm(originalHotel.Lat, originalHotel.Lng, candidateHotel.Lat, candidateHotel.Lng);
        var capacityDiff = originalRoom is null ? 0 : Math.Abs(candidateRoom.Capacity - originalRoom.Capacity);
        var amenityOverlap = originalRoom is null ? 0 : candidateRoom.Amenities.Intersect(originalRoom.Amenities).Count();
        var stayedBeforeBonus = guestPreviousHotelIds.Contains(candidateHotel.Id) ? 1 : 0;

        return distanceKm
            + capacityDiff * 5
            - amenityOverlap * 3
            - stayedBeforeBonus * 20
            + (double)candidateRoom.PriceAmount / 100;
    }

    // 跟 ScoreAlternate 用同一批信号,只是从"打分"换成"挑一句人话说明"——按信号强弱排优先级,
    // 不用 Gemini 现编:这段文案只是把已经算出来的数字翻译成一句话,没有语义生成需求，
    // 犯不着为了一句话再搭一次网络调用(既慢又多一个失败点)。
    // preference 是客人这次明确要求的挑选依据(cheaper/closer/larger)，null/"other" 落回下面
    // 原有的启发式说明链——这几句跟 ScoreAlternate/SelectAlternateCandidateAsync 的排序标准一一对应，
    // 不能两边各说各的(比如按价格选出来却说"离你很近")。
    private static string BuildAlternateReason(Hotel candidateHotel, RoomType candidateRoom, RoomType? originalRoom,
        HashSet<Guid> guestPreviousHotelIds, double? distanceKm, string? preference = null)
    {
        if (preference == "cheaper" && distanceKm is { } kmCheaper) return $"Cheaper option, about {Math.Round(kmCheaper)} km away.";
        if (preference == "closer" && distanceKm is { } kmCloser) return $"Closer to your original hotel, about {Math.Round(kmCloser)} km away.";
        if (preference == "larger") return $"Bigger room, sleeps {candidateRoom.Capacity}{(originalRoom is not null ? $" (vs {originalRoom.Capacity})" : "")}.";
        if (guestPreviousHotelIds.Contains(candidateHotel.Id)) return "You've stayed here before.";
        if (distanceKm is { } km && km <= 1) return "Right next to your original hotel.";
        if (distanceKm is { } km2 && km2 <= 20) return $"Only {Math.Round(km2)} km from your original hotel.";
        if (originalRoom is not null && candidateRoom.Capacity == originalRoom.Capacity) return "Same room size as your original booking.";
        if (originalRoom is not null && candidateRoom.Amenities.Intersect(originalRoom.Amenities).Any()) return "Shares amenities with your original room.";
        return "The closest match we could find among available hotels.";
    }

    private record AlternateCandidateSelection(Hotel Hotel, RoomType RoomType, decimal FeeDiff, double? DistanceKm, string Reason, bool RanOutOfNewOptions);

    // 挑候选酒店/房型的核心逻辑，从 BuildDraftOptionsAsync 拆出来是因为 PreviewAlternateAsync
    // 需要同一套挑选/打分规则做只读预览(不落库、不占用 AddAlternateOfferAsync 的"已推荐"名额)，
    // 两处一旦分叉，预览给客人看的和最终真正生成的就可能对不上。
    // preference: null/"other"=默认综合打分(ScoreAlternate)；"cheaper"=价格升序；
    // "closer"=离原酒店距离升序；"larger"=房型容量降序——都只是候选池的排序标准，
    // 打平/候选池只剩一个时统一用 ScoreAlternate 兜底排序。
    private async Task<AlternateCandidateSelection?> SelectAlternateCandidateAsync(Case c, string? preference, CancellationToken ct)
    {
        var booking = c.Booking!;
        var nights = Math.Max(booking.CheckOut.DayNumber - booking.CheckIn.DayNumber, 1);
        var candidates = await repo.ListAlternateCandidatesAsync(booking.HotelId, ct);
        var alreadyOfferedHotelIds = await repo.ListOfferedAlternateHotelIdsAsync(c.Id, ct);
        var unseenCandidates = candidates.Where(cand => !alreadyOfferedHotelIds.Contains(cand.Hotel.Id)).ToList();
        var ranOutOfNewOptions = candidates.Count > 0 && unseenCandidates.Count == 0;
        if (unseenCandidates.Count > 0) candidates = unseenCandidates;
        if (candidates.Count == 0) return null;

        var previousHotelIds = (await bookingRepo.ListForGuestAsync(booking.GuestUserId, ct)).Select(b => b.HotelId).ToHashSet();
        var ordered = preference switch
        {
            "cheaper" => candidates.OrderBy(cand => cand.RoomType.PriceAmount),
            "closer" when booking.Hotel is not null => candidates.OrderBy(cand =>
                HaversineKm(booking.Hotel.Lat, booking.Hotel.Lng, cand.Hotel.Lat, cand.Hotel.Lng)),
            "larger" => candidates.OrderByDescending(cand => cand.RoomType.Capacity),
            _ => null,
        };
        var (hotel, roomType) = ordered is not null
            ? ordered.ThenBy(cand => ScoreAlternate(cand.Hotel, cand.RoomType, booking.Hotel, booking.RoomType, previousHotelIds)).First()
            : candidates.MinBy(cand => ScoreAlternate(cand.Hotel, cand.RoomType, booking.Hotel, booking.RoomType, previousHotelIds));

        var originalNightly = booking.RoomType?.PriceAmount ?? booking.TotalAmount / nights;
        var feeDiff = Math.Round((roomType.PriceAmount - originalNightly) * nights, 2);
        var distanceKm = booking.Hotel is not null
            ? Math.Round(HaversineKm(booking.Hotel.Lat, booking.Hotel.Lng, hotel.Lat, hotel.Lng), 0)
            : (double?)null;
        var reason = BuildAlternateReason(hotel, roomType, booking.RoomType, previousHotelIds, distanceKm, preference);
        return new AlternateCandidateSelection(hotel, roomType, feeDiff, distanceKm, reason, ranOutOfNewOptions);
    }

    // 只读预览："客人要求换一个更符合某个条件(更便宜/更近/更大)的方案"这一步要把候选方案的
    // 图片/理由先给客人看，但还没确认，不能真的占用 AddAlternateOfferAsync 的"已推荐"名额或
    // 改动 Option 表——万一客人不要，候选池不该被这次预览提前消耗掉。真正落库交给 RegenerateAlternateAsync。
    public async Task<AlternateCandidatePreviewDto?> PreviewAlternateAsync(Guid caseId, string? preference, CancellationToken ct = default)
    {
        var c = await repo.FindCaseWithContextAsync(caseId, ct) ?? throw new CaseNotFoundException();
        var selection = await SelectAlternateCandidateAsync(c, preference, ct);
        if (selection is null) return null;
        return new AlternateCandidatePreviewDto(
            selection.Hotel.Name, selection.RoomType.Name, selection.RoomType.Description, selection.RoomType.Amenities, selection.RoomType.ImageUrls,
            selection.FeeDiff, c.Booking!.Currency, selection.DistanceKm, selection.Reason);
    }

    private async Task<List<Option>> BuildDraftOptionsAsync(Case c, IEnumerable<string> typesToBuild, CancellationToken ct, string? preference = null)
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
            var selection = await SelectAlternateCandidateAsync(c, preference, ct);
            if (selection is not null)
            {
                var (hotel, roomType, feeDiff, distanceKm, reason, ranOutOfNewOptions) = selection;
                await repo.AddAlternateOfferAsync(c.Id, hotel.Id, ct);
                var altPayload = JsonSerializer.Serialize(new
                {
                    hotel = hotel.Name,
                    hotel_id = hotel.Id,
                    room_type = roomType.Name,
                    room_description = roomType.Description,
                    room_amenities = roomType.Amenities,
                    room_image_urls = roomType.ImageUrls,
                    fee_diff = feeDiff,
                    currency = booking.Currency,
                    distance_km = distanceKm,
                    reason,
                });
                built.Add(new Option
                {
                    Id = Guid.NewGuid(), CaseId = c.Id, OptionType = "alternate", PayloadJson = altPayload,
                    Availability = "pending", CreatedAt = now, UpdatedAt = now,
                });

                if (ranOutOfNewOptions)
                {
                    var language = booking.GuestUser?.Language ?? "en";
                    var noNewOptionsText = language == "zh"
                        ? "这附近能推荐的酒店暂时没有新的了，还是这一家——如果想让人工再看看，直接在这里说一声就行。"
                        : "We don't have a new hotel to suggest right now, so here's the same recommendation again — just say so here if you'd like a coordinator to take another look.";
                    await repo.AddMessageAsync(new Message
                    {
                        Id = Guid.NewGuid(), CaseId = c.Id, SenderRole = "system", Thread = "ai",
                        Content = noNewOptionsText, CreatedAt = now, UpdatedAt = now,
                    }, ct);
                }
            }
        }

        if (types.Contains("cancel"))
        {
            var policy = await hotelRepo.GetActiveRefundPolicyAsync(booking.HotelId, ct);
            // 没配置政策的酒店不支持退款——这是 CaseService.GetPolicySummaryAsync/BuildPromptAsync
            // 早就在跟客人说的话("hotel has not set up a refund policy...does not support
            // cancellation-for-refund")。之前这里不管有没有政策都照样调 CalculateRefund，policy
            // 传 null 时它会静默套一个没人配置过的默认 10% 手续费算出一个"能退"的金额，
            // 跟聊天里说的"不支持退款"自相矛盾——协调台看到的是编出来的数字，不是真数据。
            if (policy is null)
            {
                var noPolicyPayload = JsonSerializer.Serialize(new { currency = booking.Currency });
                built.Add(new Option
                {
                    Id = Guid.NewGuid(), CaseId = c.Id, OptionType = "cancel", PayloadJson = noPolicyPayload,
                    Availability = "unavailable", UnavailableReason = "This hotel has not set up a refund policy.",
                    CreatedAt = now, UpdatedAt = now,
                });
            }
            else
            {
                var rules = RefundPolicyParser.Parse(policy.StructuredRulesJson);
                var (cancellationFee, refundAmount) = RefundPolicyParser.CalculateRefund(booking.TotalAmount, rules, booking.CheckIn, now);
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

    // 只重算 alternate 一种类型，不动 defer/cancel——供对话内"客人确认要换一个方案"这条链路调用，
    // 跟协调员手动触发的 RegenerateAsync(重算全部未锁定类型)是两回事，不要合并。
    public async Task<Option?> RegenerateAlternateAsync(Guid caseId, string? preference, CancellationToken ct = default)
    {
        var c = await repo.FindCaseWithContextAsync(caseId, ct) ?? throw new CaseNotFoundException();
        if (c.Status == "closed") throw new CaseClosedException();
        var options = await repo.ListOptionsAsync(caseId, ct);
        foreach (var o in options.Where(o => o.OptionType == "alternate" && !o.Locked))
            await repo.RemoveOptionAsync(o, ct);

        var drafts = await BuildDraftOptionsAsync(c, ["alternate"], ct, preference);
        foreach (var d in drafts) await repo.AddOptionAsync(d, ct);
        await repo.SaveChangesAsync(ct);
        return drafts.FirstOrDefault(d => d.OptionType == "alternate");
    }

    public async Task<PushOptionsStatusDto> GetPushStatusAsync(Guid caseId, CancellationToken ct = default)
    {
        if (await repo.FindCaseStatusAsync(caseId, ct) is null) throw new CaseNotFoundException();
        var options = await repo.ListOptionsAsync(caseId, ct);
        if (options.Any(o => o.Selected && o.ExecutionRequestedAt.HasValue))
            return new PushOptionsStatusDto(false, "guest_confirmed", null);
        var latestOptionUpdate = await repo.FindLatestOptionUpdateAsync(caseId, ct);
        var latestSuccess = await repo.FindLatestOptionsPushAsync(caseId, successfulOnly: true, ct);
        var latestAttempt = await repo.FindLatestOptionsPushAsync(caseId, successfulOnly: false, ct);

        if (latestOptionUpdate is not null && latestSuccess?.SentAt >= latestOptionUpdate)
            return new PushOptionsStatusDto(false, "sent", latestSuccess.SentAt);
        if (latestAttempt is not null && !latestAttempt.Success &&
            (latestOptionUpdate is null || latestAttempt.SentAt >= latestOptionUpdate))
            return new PushOptionsStatusDto(true, "retry", latestAttempt.SentAt);
        if (latestSuccess is not null)
            return new PushOptionsStatusDto(true, "updated", latestSuccess.SentAt);
        return new PushOptionsStatusDto(true, "ready", latestAttempt?.SentAt);
    }

    public async Task<PushOptionsResultDto> PushAsync(Guid caseId, CancellationToken ct = default)
    {
        await using var transaction = await repo.BeginTransactionAsync(ct);
        if (!await repo.LockCaseForUpdateAsync(caseId, ct)) throw new CaseNotFoundException();
        var c = await repo.FindCaseWithContextAsync(caseId, ct) ?? throw new CaseNotFoundException();
        if (c.Status == "closed") throw new CaseClosedException();
        var options = await repo.ListOptionsAsync(caseId, ct);
        if (options.Any(o => o.Selected && o.ExecutionRequestedAt.HasValue))
            throw new GuestSelectionSubmittedException();
        var latestOptionUpdate = await repo.FindLatestOptionUpdateAsync(caseId, ct);
        var latestSuccess = await repo.FindLatestOptionsPushAsync(caseId, successfulOnly: true, ct);
        if (latestOptionUpdate is null) throw new NoOptionsToPushException();
        if (latestSuccess?.SentAt >= latestOptionUpdate) throw new OptionsAlreadyPushedException();
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
        await transaction.CommitAsync(ct);
        return new PushOptionsResultDto(success, now);
    }
}

public sealed class OptionsAlreadyPushedException : Exception { }
public sealed class NoOptionsToPushException : Exception { }
public sealed class GuestSelectionSubmittedException : Exception { }
