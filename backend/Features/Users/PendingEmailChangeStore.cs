using System.Collections.Concurrent;

namespace TravelDisruptionAgent.Api.Features.Users;

/// <summary>
/// 邮箱修改验证码的最小实现：进程内内存存储，不落库、不真发邮件（邮件通道 Task 6 才接入）。
/// 单实例开发环境够用；生产要真做验证码要换成带过期的持久化存储。
/// </summary>
public class PendingEmailChangeStore
{
    private record Entry(string NewEmail, string Code, DateTimeOffset ExpiresAt);

    private readonly ConcurrentDictionary<Guid, Entry> _pending = new();

    public string IssueCode(Guid userId, string newEmail)
    {
        var code = Random.Shared.Next(100000, 999999).ToString();
        _pending[userId] = new Entry(newEmail, code, DateTimeOffset.UtcNow.AddMinutes(10));
        return code;
    }

    public bool TryConfirm(Guid userId, string newEmail, string code)
    {
        if (!_pending.TryGetValue(userId, out var entry)) return false;
        if (entry.ExpiresAt < DateTimeOffset.UtcNow) return false;
        if (entry.NewEmail != newEmail || entry.Code != code) return false;
        _pending.TryRemove(userId, out _);
        return true;
    }
}
