using TravelDisruptionAgent.Api.Features.Chat;
using TravelDisruptionAgent.Api.Features.Coordinator;
using TravelDisruptionAgent.Api.Features.HotelPortal;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Email;
using DisruptionEntity = TravelDisruptionAgent.Api.Infrastructure.Data.Entities.Disruption;

namespace TravelDisruptionAgent.Api.Features.Disruption;

public class DisruptionService(
    IDisruptionRepository repo, ICoordinatorRepository coordinatorRepo, ICoordinatorService coordinatorService, IEmailService email,
    IChatService chat, IHotelRepository hotelRepo, ILogger<DisruptionService> logger)
    : IDisruptionService
{
    private async Task<Dictionary<Guid, string>> CoordinatorNamesAsync(CancellationToken ct) =>
        (await coordinatorRepo.ListCoordinatorsAsync(ct)).ToDictionary(u => u.Id, u => u.Nickname);

    private static string? Name(Guid? id, Dictionary<Guid, string> names) =>
        id.HasValue && names.TryGetValue(id.Value, out var n) ? n : null;

    public async Task<List<DisruptionListItemDto>> ListAsync(string? type, string? region, CancellationToken ct = default)
    {
        var list = await repo.ListAsync(type, region, ct);
        var names = await CoordinatorNamesAsync(ct);
        var result = new List<DisruptionListItemDto>();
        foreach (var d in list)
        {
            var affected = await repo.CountAffectedAsync(d.Id, ct);
            result.Add(new DisruptionListItemDto(d.Id, d.Type, d.EventSubtype, d.Severity, d.Title, d.Region, d.StartAt, d.EndAtOrWindow,
                d.Status, affected, d.AssigneeCoordinatorId, Name(d.AssigneeCoordinatorId, names)));
        }
        return result;
    }

    public async Task<Guid> IngestAsync(CreateDisruptionRequest request, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var disruption = new DisruptionEntity
        {
            Id = Guid.NewGuid(), Type = request.Type, Title = request.Title, Region = request.Region,
            StartAt = request.StartAt, EndAtOrWindow = request.EndAtOrWindow, Status = "active",
            RawSignalText = request.RawSignalText, CreatedAt = now, UpdatedAt = now,
        };
        await repo.AddDisruptionAsync(disruption, ct);
        await repo.SaveChangesAsync(ct);
        return disruption.Id;
    }

    public async Task<DisruptionDetailDto> GetAsync(Guid id, CancellationToken ct = default)
    {
        var d = await repo.FindByIdAsync(id, ct) ?? throw new DisruptionNotFoundException();
        var affected = await repo.CountAffectedAsync(id, ct);
        var names = await CoordinatorNamesAsync(ct);
        return new DisruptionDetailDto(d.Id, d.Type, d.EventSubtype, d.Severity, d.Title, d.Region,
            d.Lat, d.Lng, d.RadiusKm, d.StartAt, d.EndAtOrWindow, d.Status,
            d.RawSignalText, d.RawSignalJson, affected, d.AssigneeCoordinatorId, Name(d.AssigneeCoordinatorId, names));
    }

    public async Task AssignAsync(Guid id, Guid toCoordinatorId, CancellationToken ct = default)
    {
        var d = await repo.FindByIdAsync(id, ct) ?? throw new DisruptionNotFoundException();
        d.AssigneeCoordinatorId = toCoordinatorId;
        d.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
    }

    public async Task AdjustWindowAsync(Guid id, AdjustWindowRequest request, Guid actorUserId, CancellationToken ct = default)
    {
        var d = await repo.FindByIdAsync(id, ct) ?? throw new DisruptionNotFoundException();
        await repo.AddWindowAuditAsync(new DisruptionWindowAudit
        {
            Id = Guid.NewGuid(), DisruptionId = id, ActorUserId = actorUserId,
            OldStartAt = d.StartAt, OldEndAtOrWindow = d.EndAtOrWindow,
            NewStartAt = request.StartAt, NewEndAtOrWindow = request.EndAtOrWindow,
            CreatedAt = DateTimeOffset.UtcNow,
        }, ct);
        d.StartAt = request.StartAt;
        d.EndAtOrWindow = request.EndAtOrWindow;
        d.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
    }

    // ponytail: 解除中断目前只把 Disruption 状态置为 closed，不级联去关联案件；案件该不该跟着结案
    // 走协调员现有的关单流程去人工判断，不在这里自动做决定。
    public async Task ResolveAsync(Guid id, CancellationToken ct = default)
    {
        var d = await repo.FindByIdAsync(id, ct) ?? throw new DisruptionNotFoundException();
        d.Status = "closed";
        d.UpdatedAt = DateTimeOffset.UtcNow;
        await repo.SaveChangesAsync(ct);
    }

    public async Task<List<CandidateBookingDto>> GetCandidatesAsync(Guid id, CancellationToken ct = default)
    {
        var d = await repo.FindByIdAsync(id, ct) ?? throw new DisruptionNotFoundException();
        var bookings = await repo.ListCandidateBookingsAsync(d, ct);
        var highValue = await repo.GetHighValueGuestIdsAsync(bookings.Select(b => b.GuestUserId), ct);
        return [.. bookings.Select(b => new CandidateBookingDto(
            b.Id, b.ConfirmationNo, b.GuestUser?.Nickname ?? "", b.Hotel?.Name ?? "", b.CheckIn, b.CheckOut,
            highValue.Contains(b.GuestUserId)))];
    }

    public async Task ExcludeCandidateAsync(Guid id, ExcludeCandidateRequest request, CancellationToken ct = default)
    {
        await repo.AddExclusionAsync(new DisruptionExclusion
        {
            Id = Guid.NewGuid(), DisruptionId = id, BookingId = request.BookingId, Reason = request.Reason, CreatedAt = DateTimeOffset.UtcNow,
        }, ct);
        await repo.SaveChangesAsync(ct);
    }

    public async Task<NotifyCandidatesResultDto> NotifyCandidatesAsync(Guid id, NotifyCandidatesRequest request, CancellationToken ct = default)
    {
        var d = await repo.FindByIdAsync(id, ct) ?? throw new DisruptionNotFoundException();
        var candidates = await repo.ListCandidateBookingsAsync(d, ct);
        var toNotify = candidates.Where(b => request.BookingIds.Contains(b.Id)).ToList();
        var now = DateTimeOffset.UtcNow;
        var count = 0;

        foreach (var booking in toNotify)
        {
            var assignee = await coordinatorService.AssignLeastBusyCoordinatorAsync(ct);
            var caseEntity = new Case
            {
                Id = Guid.NewGuid(), BookingId = booking.Id, DisruptionId = id, Status = "pending",
                Priority = request.Priority, AssigneeCoordinatorId = assignee, CreatedAt = now, UpdatedAt = now,
                Disruption = d, Booking = booking,
            };
            await repo.AddCaseAsync(caseEntity, ct);

            // 开场白必须在这里生成、跟 case 一起落库——不能靠"客人第一次打开对话页才补"那套
            // (EnsureProactiveOpeningAsync 只在线程一条消息都没有时才补): 如果酒店在客人打开对话页
            // 之前就已经处理完 H1 请求，那条决定消息会先落库，"线程非空"这个判断条件就失效了，
            // 客人永远看不到这条说明中断情况本身的开场白，直接从"已批准"开始看，体验不连贯。
            var openingLanguage = booking.GuestUser?.Language ?? "en";
            var isReturningGuest = (await hotelRepo.GetReturningGuestIdsAsync([booking.GuestUserId], booking.HotelId, ct)).Count > 0;
            await repo.AddMessageAsync(new Message
            {
                Id = Guid.NewGuid(), CaseId = caseEntity.Id, SenderRole = "system",
                Content = chat.BuildProactiveOpening(caseEntity, hotelConfirmed: false, openingLanguage, isReturningGuest),
                CreatedAt = now, UpdatedAt = now,
            }, ct);

            if (assignee.HasValue)
            {
                await coordinatorRepo.AddAssignmentAsync(new CaseAssignment
                {
                    Id = Guid.NewGuid(), CaseId = caseEntity.Id, ActorUserId = assignee.Value,
                    FromCoordinatorId = null, ToCoordinatorId = assignee.Value, Action = "assign", CreatedAt = now,
                }, ct);
            }

            // 先询原酒店延期/留房：落一条待响应询单，酒店端的"确认可用"流程会接手后续。
            await repo.AddInquiryAsync(new Inquiry
            {
                Id = Guid.NewGuid(), CaseId = caseEntity.Id, HotelId = booking.HotelId, Type = "defer",
                Status = "pending", RequestedAt = now, CreatedAt = now, UpdatedAt = now,
            }, ct);

            var guest = booking.GuestUser;
            if (guest is not null)
            {
                // 跟 HotelService.ToDto / CaseService.ExecuteOptionAsync 同一套规则(比原定入住日期
                // 晚3天、保持原住宿晚数)——客人第一时间就该知道系统打算把日期改到几号，不满意
                // 可以在案件对话里提出别的日期，不用等酒店确认完才第一次看到具体方案。
                var proposedNights = Math.Max(booking.CheckOut.DayNumber - booking.CheckIn.DayNumber, 1);
                var proposedCheckIn = booking.CheckIn.AddDays(3);
                var proposedCheckOut = proposedCheckIn.AddDays(proposedNights);
                var deferSuffix = $" If the hotel accepts, your stay would move to {proposedCheckIn:yyyy-MM-dd} → {proposedCheckOut:yyyy-MM-dd} (estimated) — let us know in the conversation if you'd prefer different dates.";

                // 这条是首页"Disruption notices"卡片显示的内容——定位是播报"发生了什么中断"这种
                // 通用消息，故意不带确认号/具体日期这些个性化细节：那些已经在旁边"My to-dos"卡片
                // 里完整展示了，两边都塞一样的东西只是重复。邮件(下面 guestPlainBody)不受这条限制，
                // 邮件是独立场景，没有"My to-dos"卡片跟它并排，该有的细节照样带。
                await repo.AddNotificationAsync(new Notification
                {
                    Id = Guid.NewGuid(), UserId = guest.Id, Channel = "email", Type = "disruption_notice",
                    Title = "Your booking may be affected",
                    Body = $"Due to {d.Title}, your booking at {booking.Hotel?.Name} may be affected. We're checking with the hotel.",
                    CaseId = caseEntity.Id, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
                }, ct);

                var caseLink = CaseEmailLinks.BuildCaseLink(caseEntity.Id);
                var guestPlainBody =
                    $"Due to {d.Title}, your booking at {booking.Hotel?.Name} ({booking.ConfirmationNo}) may be affected. " +
                    $"We're checking with the hotel and will update you shortly.{deferSuffix}\n\nView this case: {caseLink}";
                var guestHtmlBody = EmailTemplate.Build("Your booking may be affected", $"""
                    <p>Due to {System.Net.WebUtility.HtmlEncode(d.Title)}, your booking at
                    {System.Net.WebUtility.HtmlEncode(booking.Hotel?.Name)} ({System.Net.WebUtility.HtmlEncode(booking.ConfirmationNo)}) may be affected.
                    We're checking with the hotel and will update you shortly.</p>
                    <p>{System.Net.WebUtility.HtmlEncode(deferSuffix.Trim())}</p>
                    {EmailTemplate.Button(caseLink, "View this case")}
                    """);
                try
                {
                    await email.SendEmailAsync(guest.Email, "Your booking may be affected", guestPlainBody, ct, guestHtmlBody);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // 邮件失败不回滚已落库的通知记录，跟站内通知本来就该独立存在——但吞掉异常之前
                    // 之前是彻底不留痕迹，SMTP 真出问题时无从判断是没配置、认证失败还是网络问题。
                    logger.LogWarning(ex, "Failed to send disruption notice email to {Email}", guest.Email);
                }
            }

            var hotelUserId = await repo.FindHotelAccountUserIdAsync(booking.HotelId, ct);
            if (hotelUserId is not null)
            {
                var hotelBody = $"Due to {d.Title}, booking {booking.ConfirmationNo} needs your response — check My to-dos.";
                await repo.AddNotificationAsync(new Notification
                {
                    Id = Guid.NewGuid(), UserId = hotelUserId.Value, Channel = "in_app", Type = "new_inquiry",
                    Title = "New disruption affects a booking",
                    Body = hotelBody,
                    CaseId = caseEntity.Id, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
                }, ct);

                var hotelEmail = await repo.FindHotelAccountEmailAsync(booking.HotelId, ct);
                if (!string.IsNullOrWhiteSpace(hotelEmail))
                {
                    // 酒店账号没有案件对话页可看，链接指回酒店自己的待办首页(见 CaseEmailLinks.BuildHotelHomeLink 的注释)。
                    var hotelHomeLink = CaseEmailLinks.BuildHotelHomeLink();
                    var hotelHtmlBody = EmailTemplate.Build("New disruption affects a booking", $"""
                        <p>{System.Net.WebUtility.HtmlEncode(hotelBody)}</p>
                        {EmailTemplate.Button(hotelHomeLink, "Open your dashboard")}
                        """);
                    try
                    {
                        await email.SendEmailAsync(hotelEmail, "New disruption affects a booking",
                            $"{hotelBody}\n\nOpen your dashboard: {hotelHomeLink}", ct, hotelHtmlBody);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        logger.LogWarning(ex, "Failed to send disruption notice email to {Email}", hotelEmail);
                    }
                }
            }

            count++;
        }

        await repo.SaveChangesAsync(ct);
        return new NotifyCandidatesResultDto(count);
    }
}
