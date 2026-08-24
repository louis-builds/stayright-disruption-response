using TravelDisruptionAgent.Api.Features.Coordinator;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Email;
using DisruptionEntity = TravelDisruptionAgent.Api.Infrastructure.Data.Entities.Disruption;

namespace TravelDisruptionAgent.Api.Features.Disruption;

public class DisruptionService(
    IDisruptionRepository repo, ICoordinatorRepository coordinatorRepo, ICoordinatorService coordinatorService, IEmailService email)
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
            result.Add(new DisruptionListItemDto(d.Id, d.Type, d.Title, d.Region, d.StartAt, d.EndAtOrWindow,
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
        return new DisruptionDetailDto(d.Id, d.Type, d.Title, d.Region, d.StartAt, d.EndAtOrWindow, d.Status,
            d.RawSignalText, affected, d.AssigneeCoordinatorId, Name(d.AssigneeCoordinatorId, names));
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
            };
            await repo.AddCaseAsync(caseEntity, ct);

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
                await repo.AddNotificationAsync(new Notification
                {
                    Id = Guid.NewGuid(), UserId = guest.Id, Channel = "email", Type = "disruption_notice",
                    Title = "Your booking may be affected",
                    Body = $"Due to {d.Title}, your booking at {booking.Hotel?.Name} may be affected. We're checking with the hotel.",
                    CaseId = caseEntity.Id, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
                }, ct);

                try
                {
                    await email.SendEmailAsync(guest.Email, "Your booking may be affected",
                        $"Due to {d.Title}, your booking at {booking.Hotel?.Name} ({booking.ConfirmationNo}) may be affected. We're checking with the hotel and will update you shortly.\n\nView this case: {CaseEmailLinks.BuildCaseLink(caseEntity.Id)}", ct);
                }
                catch
                {
                    // ponytail: 邮件失败不回滚已落库的通知记录，跟站内通知本来就该独立存在。
                }
            }

            var hotelUserId = await repo.FindHotelAccountUserIdAsync(booking.HotelId, ct);
            if (hotelUserId is not null)
            {
                await repo.AddNotificationAsync(new Notification
                {
                    Id = Guid.NewGuid(), UserId = hotelUserId.Value, Channel = "in_app", Type = "new_inquiry",
                    Title = "New disruption affects a booking",
                    Body = $"Due to {d.Title}, booking {booking.ConfirmationNo} needs your response — check My to-dos.",
                    CaseId = caseEntity.Id, SentAt = now, Success = true, CreatedAt = now, UpdatedAt = now,
                }, ct);
            }

            count++;
        }

        await repo.SaveChangesAsync(ct);
        return new NotifyCandidatesResultDto(count);
    }
}
