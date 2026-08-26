using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace TravelDisruptionAgent.Api.Infrastructure.Auth;

// 探测器（Lambda）是机器调用，不走 cookie 会话，改用共享密钥比对请求头。
public class IngestKeyAuthFilter(IConfiguration config) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var expected = Environment.GetEnvironmentVariable("INGEST_SHARED_KEY") ?? config["INGEST_SHARED_KEY"];
        var provided = context.HttpContext.Request.Headers["X-Ingest-Key"].FirstOrDefault();

        if (string.IsNullOrEmpty(expected) || provided != expected)
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        await next();
    }
}
