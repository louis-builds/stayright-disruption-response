namespace TravelDisruptionAgent.Api.Features.Auth;

/// <summary>业务级校验失败（跨字段条件必填、重复邮箱等），Controller 统一捕获转 400。</summary>
public class AuthValidationException(string message) : Exception(message);
