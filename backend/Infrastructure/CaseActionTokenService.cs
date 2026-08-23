using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace TravelDisruptionAgent.Api.Infrastructure;

public record CaseActionPayload(Guid CaseId, Guid OptionId, Guid GuestUserId);

/// <summary>邮件里"一键确认"按钮用的签名令牌。用内置 Data Protection（自带过期时间校验），
/// 不新建依赖、不用自己管密钥轮换。</summary>
public class CaseActionTokenService(IDataProtectionProvider dp)
{
    private readonly ITimeLimitedDataProtector protector =
        dp.CreateProtector("case-option-select-action").ToTimeLimitedDataProtector();

    public string Create(CaseActionPayload payload) =>
        protector.Protect(JsonSerializer.Serialize(payload), DateTimeOffset.UtcNow.AddDays(14));

    // 过期/被篡改/格式不对统一吃掉返回 null，调用方不用分情况处理不同的失败原因。
    public CaseActionPayload? TryRead(string token)
    {
        try
        {
            return JsonSerializer.Deserialize<CaseActionPayload>(protector.Unprotect(token));
        }
        catch
        {
            return null;
        }
    }
}
