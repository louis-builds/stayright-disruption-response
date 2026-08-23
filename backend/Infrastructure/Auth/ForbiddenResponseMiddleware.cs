using System.Text.Json;

namespace TravelDisruptionAgent.Api.Infrastructure.Auth;

// 未登录(401)/无权限(403) 统一改写成 开发规范.md 2.2 节的响应体，
// 前端只认 code === 403，不按 HTTP 状态码字符串匹配。
public class ForbiddenResponseMiddleware(RequestDelegate next)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public async Task InvokeAsync(HttpContext context)
    {
        await next(context);

        if ((context.Response.StatusCode == StatusCodes.Status401Unauthorized ||
             context.Response.StatusCode == StatusCodes.Status403Forbidden) &&
            !context.Response.HasStarted)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/json";
            var body = JsonSerializer.Serialize(ApiResponse.Forbidden(), JsonOptions);
            await context.Response.WriteAsync(body);
        }
    }
}
