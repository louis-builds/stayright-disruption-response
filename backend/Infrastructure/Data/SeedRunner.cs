using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TravelDisruptionAgent.Api.Infrastructure.Data.Entities;
using TravelDisruptionAgent.Api.Infrastructure.Storage;

namespace TravelDisruptionAgent.Api.Infrastructure.Data;

/// <summary>
/// 从 SeedData/*.json 导入种子数据。幂等：只要 users 表已有数据就直接跳过整个导入。
/// 假定进程 cwd 是 backend/ 项目目录（dotnet run 默认如此），SeedData 相对路径才能解析。
/// </summary>
public static class SeedRunner
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    // 这两份是唯一走 S3/本地全局开关的种子 RAG 文档；取消与改订政策.md 保持固定读本地仓库文件，
    // 不受 RAG_DOC_SOURCE 影响（团队决定：那份还在走别的审核/发布流程，先不搬）。
    private static readonly HashSet<string> S3EligibleRagDocFiles = ["使用说明.md", "常见问题.md"];

    public static async Task RunAsync(AppDbContext db, IRagDocumentSource ragDocumentSource, ILogger logger, CancellationToken ct = default)
    {
        if (await db.Users.AnyAsync(ct))
        {
            logger.LogInformation("Seed skipped: users table already has data.");
            return;
        }

        var seedDir = Path.Combine(Directory.GetCurrentDirectory(), "SeedData");
        var now = DateTimeOffset.UtcNow;

        var hotels = Load<HotelSeed>(seedDir, "hotels.json");
        db.Hotels.AddRange(hotels.Select(h => new Hotel
        {
            Id = h.Id, Name = h.Name, Address = h.Address, Lat = h.Lat, Lng = h.Lng,
            GooglePlaceId = h.GooglePlaceId, Status = h.Status, CreatedAt = now, UpdatedAt = now,
        }));

        var roomTypes = Load<RoomTypeSeed>(seedDir, "room_types.json");
        db.RoomTypes.AddRange(roomTypes.Select(r => new RoomType
        {
            Id = r.Id, HotelId = r.HotelId, Name = r.Name, Description = r.Description,
            Amenities = r.Amenities, Capacity = r.Capacity, PriceAmount = r.PriceAmount,
            Currency = r.Currency, ImageUrls = r.ImageUrls, CreatedAt = now, UpdatedAt = now,
        }));

        var users = Load<UserSeed>(seedDir, "users.json");
        db.Users.AddRange(users.Select(u => new User
        {
            Id = u.Id, Role = u.Role, Email = u.Email, Phone = u.Phone, Nickname = u.Nickname,
            Gender = u.Gender, Language = u.Language,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(u.PasswordPlaintext),
            HotelId = u.HotelId, Status = u.Status, CreatedAt = now, UpdatedAt = now,
        }));

        var bookings = Load<BookingSeed>(seedDir, "bookings.json");
        db.Bookings.AddRange(bookings.Select(b => new Booking
        {
            Id = b.Id, ConfirmationNo = b.ConfirmationNo, GuestUserId = b.GuestUserId,
            HotelId = b.HotelId, RoomTypeId = b.RoomTypeId,
            CheckIn = DateOnly.FromDateTime(now.UtcDateTime).AddDays(b.CheckInOffsetDays),
            CheckOut = DateOnly.FromDateTime(now.UtcDateTime).AddDays(b.CheckOutOffsetDays),
            GuestsCount = b.GuestsCount, TotalAmount = b.TotalAmount, Currency = b.Currency,
            Status = b.Status, CreatedAt = now, UpdatedAt = now,
        }));

        var disruptions = Load<DisruptionSeed>(seedDir, "disruptions.json");
        db.Disruptions.AddRange(disruptions.Select(d => new Disruption
        {
            Id = d.Id, Type = d.Type, EventSubtype = d.EventSubtype, Title = d.Title, Region = d.Region,
            Severity = d.Severity, Lat = d.Lat, Lng = d.Lng, RadiusKm = d.RadiusKm,
            StartAt = now.AddHours(d.StartOffsetHours), EndAtOrWindow = now.AddHours(d.EndOffsetHours),
            Status = d.Status, RawSignalText = d.RawSignalText, RawSignalJson = d.RawSignalJson, CreatedAt = now, UpdatedAt = now,
        }));

        var cases = Load<CaseSeed>(seedDir, "cases.json");
        db.Cases.AddRange(cases.Select(c => new Case
        {
            Id = c.Id, BookingId = c.BookingId, DisruptionId = c.DisruptionId, Status = c.Status,
            AssigneeCoordinatorId = c.AssigneeCoordinatorId, Priority = c.Priority,
            CloseReason = c.CloseReason, EscalationReason = c.EscalationReason, CreatedAt = now, UpdatedAt = now,
        }));

        var messages = Load<MessageSeed>(seedDir, "messages.json");
        db.Messages.AddRange(messages.Select(m => new Message
        {
            Id = m.Id, CaseId = m.CaseId, SenderRole = m.SenderRole, Content = m.Content,
            CreatedAt = now.AddMinutes(m.CreatedOffsetMinutes),
            UpdatedAt = now.AddMinutes(m.ReadOffsetMinutes ?? m.CreatedOffsetMinutes),
            ReadAt = m.ReadOffsetMinutes.HasValue ? now.AddMinutes(m.ReadOffsetMinutes.Value) : null,
        }));

        var inquiries = Load<InquirySeed>(seedDir, "inquiries.json");
        db.Inquiries.AddRange(inquiries.Select(i => new Inquiry
        {
            Id = i.Id, CaseId = i.CaseId, HotelId = i.HotelId, Type = i.Type, Status = i.Status,
            RequestedAt = now.AddMinutes(i.RequestedOffsetMinutes),
            RespondedAt = i.RespondedOffsetMinutes.HasValue ? now.AddMinutes(i.RespondedOffsetMinutes.Value) : null,
            RejectReason = i.RejectReason, CreatedAt = now, UpdatedAt = now,
        }));

        var options = Load<OptionSeed>(seedDir, "options.json");
        db.Options.AddRange(options.Select(o => new Option
        {
            Id = o.Id, CaseId = o.CaseId, OptionType = o.OptionType,
            PayloadJson = o.Payload.GetRawText(), Availability = o.Availability, Selected = o.Selected,
            CreatedAt = now, UpdatedAt = now,
        }));

        var notifications = Load<NotificationSeed>(seedDir, "notifications.json");
        db.Notifications.AddRange(notifications.Select(n => new Notification
        {
            Id = n.Id, UserId = n.UserId, Channel = n.Channel, Type = n.Type, Title = n.Title,
            Body = n.Body, CaseId = n.CaseId, SentAt = now.AddMinutes(n.SentOffsetMinutes),
            ReadAt = n.ReadOffsetMinutes.HasValue ? now.AddMinutes(n.ReadOffsetMinutes.Value) : null,
            Success = n.Success, CreatedAt = now, UpdatedAt = now,
        }));

        var ragDocs = Load<RagDocumentSeed>(seedDir, "rag_documents.json");
        foreach (var r in ragDocs)
        {
            var localPath = Path.Combine(seedDir, r.File);
            var content = S3EligibleRagDocFiles.Contains(r.File)
                ? await ragDocumentSource.ReadAsync(r.File, localPath, ct)
                : await File.ReadAllTextAsync(localPath, ct);
            db.RagDocuments.Add(new RagDocument
            {
                Id = r.Id, Name = r.Name, Version = r.Version, Content = content,
                IsDefaultVersion = r.IsDefaultVersion, CreatedAt = now, UpdatedAt = now,
            });
        }

        var goldenTests = Load<GoldenTestSeed>(seedDir, "golden_tests.json");
        db.GoldenTests.AddRange(goldenTests.Select(g => new GoldenTest
        {
            Id = g.Id, Input = g.Input, Expect = g.Expect, Note = g.Note, CreatedAt = now, UpdatedAt = now,
        }));

        await db.SaveChangesAsync(ct);
        logger.LogInformation("Seed complete: {Users} users, {Hotels} hotels, {Bookings} bookings, {Cases} cases.",
            users.Count, hotels.Count, bookings.Count, cases.Count);
    }

    private static List<T> Load<T>(string seedDir, string fileName)
    {
        var path = Path.Combine(seedDir, fileName);
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<List<T>>(json, JsonOptions) ?? [];
    }

    private record HotelSeed(Guid Id, string Name, string Address, double Lat, double Lng, string? GooglePlaceId, string Status);

    private record RoomTypeSeed(Guid Id, Guid HotelId, string Name, string Description, List<string> Amenities,
        int Capacity, decimal PriceAmount, string Currency, List<string> ImageUrls);

    private record UserSeed(Guid Id, string Role, string Email, string Phone, string Nickname, string Gender,
        string Language, string PasswordPlaintext, Guid? HotelId, string Status);

    private record BookingSeed(Guid Id, string ConfirmationNo, Guid GuestUserId, Guid HotelId, Guid RoomTypeId,
        int CheckInOffsetDays, int CheckOutOffsetDays, int GuestsCount, decimal TotalAmount, string Currency, string Status);

    // EventSubtype/Severity/Lat/Lng/RadiusKm/RawSignalJson 对齐 docs/handoff.jsonl 的对接结构，
    // 目前只有 weather/storm 这条会填，其它 disruption 留 null 照样能反序列化。
    private record DisruptionSeed(Guid Id, string Type, string Title, string Region,
        double StartOffsetHours, double EndOffsetHours, string Status, string RawSignalText,
        string? EventSubtype = null, string? Severity = null,
        double? Lat = null, double? Lng = null, double? RadiusKm = null, string? RawSignalJson = null);

    private record CaseSeed(Guid Id, Guid BookingId, Guid DisruptionId, string Status,
        Guid? AssigneeCoordinatorId, string Priority, string? CloseReason, string? EscalationReason);

    private record MessageSeed(Guid Id, Guid CaseId, string SenderRole, string Content,
        double CreatedOffsetMinutes, double? ReadOffsetMinutes);

    private record InquirySeed(Guid Id, Guid CaseId, Guid HotelId, string Type, string Status,
        double RequestedOffsetMinutes, double? RespondedOffsetMinutes, string? RejectReason);

    private record OptionSeed(Guid Id, Guid CaseId, string OptionType, string Availability, bool Selected, JsonElement Payload);

    private record NotificationSeed(Guid Id, Guid UserId, string Channel, string Type, string Title, string Body,
        Guid? CaseId, double SentOffsetMinutes, double? ReadOffsetMinutes, bool Success);

    private record RagDocumentSeed(Guid Id, string Name, string File, int Version, bool IsDefaultVersion);

    private record GoldenTestSeed(Guid Id, string Input, string Expect, string Note);
}
