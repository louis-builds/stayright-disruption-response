using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Pgvector.EntityFrameworkCore;
using Serilog;
using TravelDisruptionAgent.Api.Features.Auth;
using TravelDisruptionAgent.Api.Features.Bookings;
using TravelDisruptionAgent.Api.Features.Calls;
using TravelDisruptionAgent.Api.Features.Tags;
using TravelDisruptionAgent.Api.Features.Push;
using TravelDisruptionAgent.Api.Features.Cases;
using TravelDisruptionAgent.Api.Features.Chat;
using TravelDisruptionAgent.Api.Features.Coordinator;
using TravelDisruptionAgent.Api.Features.Disruption;
using TravelDisruptionAgent.Api.Features.Faq;
using TravelDisruptionAgent.Api.Features.Handoff;
using TravelDisruptionAgent.Api.Features.HotelPortal;
using TravelDisruptionAgent.Api.Features.Notifications;
using TravelDisruptionAgent.Api.Features.Users;
using TravelDisruptionAgent.Api.Infrastructure;
using TravelDisruptionAgent.Api.Infrastructure.Auth;
using TravelDisruptionAgent.Api.Infrastructure.Data;
using TravelDisruptionAgent.Api.Infrastructure.Email;
using TravelDisruptionAgent.Api.Infrastructure.Storage;

// 项目根目录的 .env 是后端配置来源（Gemini/DeepSeek/Google Maps/SMTP/数据库连接），
// dotnet run 默认从 backend/ 目录起，所以 .env 在上一级。
var envPath = Path.Combine(Directory.GetCurrentDirectory(), "..", ".env");
if (File.Exists(envPath))
{
    DotNetEnv.Env.Load(envPath);
}

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, services, config) =>
{
    // 开发规范.md 2.3 节：结构化日志，固定字段 timestamp/level/traceId/module/message/extra。
    config
        .Enrich.FromLogContext()
        .Enrich.WithProperty("module", "TravelDisruptionAgent.Api")
        .WriteTo.Console(outputTemplate:
            "[{Timestamp:yyyy-MM-dd HH:mm:ss} {Level:u3}] {module} {TraceId} {Message:lj}{NewLine}{Exception}");
});

var connectionString = BuildConnectionString(builder.Configuration);
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(connectionString, o => o.UseVector()).UseSnakeCaseNamingConvention());

const string FrontendCorsPolicy = "Frontend";
// 逗号分隔支持多个本地开发前端同时联调(Web:5173、协调员App:8091、客户端App:8092),
// 不用每次切换测试对象都重启后端换 FRONTEND_ORIGIN。
var frontendOrigins = (Environment.GetEnvironmentVariable("FRONTEND_ORIGIN") ?? "http://localhost:5173,http://localhost:8091,http://localhost:8092")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
builder.Services.AddCors(options =>
{
    options.AddPolicy(FrontendCorsPolicy, policy =>
        policy.WithOrigins(frontendOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials());
});

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddSignalR();

var sessionIdleTimeoutMinutes = int.TryParse(Environment.GetEnvironmentVariable("SESSION_IDLE_TIMEOUT_MINUTES"), out var m) ? m : 60;
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "td_auth";
        options.ExpireTimeSpan = TimeSpan.FromMinutes(sessionIdleTimeoutMinutes);
        // 会话时间过半自动续期：ASP.NET Core Cookie 认证内置行为，无需手写中间件。
        options.SlidingExpiration = true;
        // API 场景下未登录/无权限直接回 401/403，不要 302 跳转到一个不存在的后端登录页。
        options.Events.OnRedirectToLogin = ctx =>
        {
            ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = ctx =>
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
        // 停用账号立即失效会话：cookie 票据本身是无状态的，每次请求都反查一次账号状态
        // （而不是等 cookie 自然过期），账号被停用后下一个请求就会被登出。
        options.Events.OnValidatePrincipal = async ctx =>
        {
            var idClaim = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            if (idClaim is null || !Guid.TryParse(idClaim, out var userId)) return;

            var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
            var status = await db.Users.Where(u => u.Id == userId).Select(u => u.Status).FirstOrDefaultAsync();
            if (status != "active")
            {
                ctx.RejectPrincipal();
                await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            }
        };
    });
builder.Services.AddAuthentication().AddScheme<AuthenticationSchemeOptions, CallSignalingAuthentication>(
    CallSignalingAuthentication.SchemeName, _ => { });
builder.Services.AddSingleton<CallSignalingTokens>();
builder.Services.AddAuthorization();

builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddSingleton<PendingEmailChangeStore>();
builder.Services.AddScoped<INotificationRepository, NotificationRepository>();
builder.Services.AddScoped<ICaseRepository, CaseRepository>();
builder.Services.AddScoped<ICaseService, CaseService>();
builder.Services.AddScoped<IEmailService, SmtpEmailService>();
builder.Services.AddSingleton<CaseActionTokenService>();
builder.Services.AddSingleton<IPolicyDocumentStorage, S3PolicyDocumentStorage>();
builder.Services.AddSingleton<IRagDocumentSource, RagDocumentSource>();
builder.Services.AddHttpClient();
builder.Services.AddScoped<IRagRepository, RagRepository>();
builder.Services.AddScoped<GeminiClient>();
builder.Services.AddScoped<IChatService, ChatService>();
builder.Services.AddScoped<IBookingRepository, BookingRepository>();
builder.Services.AddScoped<IBookingService, BookingService>();
builder.Services.AddScoped<ICoordinatorRepository, CoordinatorRepository>();
builder.Services.AddScoped<ICoordinatorService, CoordinatorService>();
builder.Services.AddScoped<IDisruptionRepository, DisruptionRepository>();
builder.Services.AddScoped<IDisruptionService, DisruptionService>();
builder.Services.AddScoped<IOptionsAdminRepository, OptionsAdminRepository>();
builder.Services.AddScoped<IOptionsAdminService, OptionsAdminService>();
builder.Services.AddScoped<IBadCaseRepository, BadCaseRepository>();
builder.Services.AddScoped<IBadCaseService, BadCaseService>();
builder.Services.AddScoped<IOpsRepository, OpsRepository>();
builder.Services.AddScoped<IOpsService, OpsService>();
builder.Services.AddScoped<ISystemAdminRepository, SystemAdminRepository>();
builder.Services.AddScoped<ISystemAdminService, SystemAdminService>();
builder.Services.AddScoped<ISystemSettingsRepository, SystemSettingsRepository>();
builder.Services.AddScoped<IKnowledgeBaseRepository, KnowledgeBaseRepository>();
builder.Services.AddScoped<IKnowledgeBaseService, KnowledgeBaseService>();
builder.Services.AddScoped<IHotelRepository, HotelRepository>();
builder.Services.AddScoped<RefundPolicyRuleExtractor>();
builder.Services.AddScoped<IHotelService, HotelService>();
builder.Services.AddScoped<IFaqRepository, FaqRepository>();
builder.Services.AddScoped<IFaqService, FaqService>();
builder.Services.AddScoped<ICallRepository, CallRepository>();
builder.Services.AddScoped<ICallService, CallService>();
builder.Services.AddScoped<CallRecordingStorage>();
builder.Services.AddScoped<CallRecordingProcessor>();
builder.Services.AddScoped<ITelephonyProvider, MockTelephonyProvider>();
builder.Services.AddScoped<IAsrProvider, MockAsrProvider>();
builder.Services.AddScoped<ITagRepository, TagRepository>();
builder.Services.AddScoped<ITagService, TagService>();
builder.Services.AddScoped<IDeviceTokenRepository, DeviceTokenRepository>();
builder.Services.AddScoped<IExpoPushSender, ExpoPushSender>();
builder.Services.AddHostedService<FaqClusteringJob>();
builder.Services.AddHostedService<HandoffIngestJob>();
builder.Services.AddMcpServer().WithHttpTransport().WithToolsFromAssembly();

var app = builder.Build();

// 本地开发统一连线上共享 stayright 库（见 docs/DATABASE_ACCESS.md）。共享库上
// 每个人 dotnet run 都自动迁移会互相踩，所以默认不动 schema：
// 迁移/seed/backfill 只在 Production（EC2 部署）或显式 RUN_DB_MIGRATE=1 时执行。
var runDbMigrate = app.Environment.IsProduction()
    || Environment.GetEnvironmentVariable("RUN_DB_MIGRATE") is "1" or "true";
if (runDbMigrate)
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
    await SeedRunner.RunAsync(db, scope.ServiceProvider.GetRequiredService<IRagDocumentSource>(), app.Logger);
    await RagChunkBackfill.RunAsync(db, scope.ServiceProvider.GetRequiredService<TravelDisruptionAgent.Api.Features.Chat.GeminiClient>(), app.Logger);
    await RagChunkBackfill.RunHotelPolicyBackfillAsync(db, scope.ServiceProvider.GetRequiredService<TravelDisruptionAgent.Api.Features.Chat.IRagRepository>(), app.Logger);
}
else
{
    app.Logger.LogInformation("Skipping DB migrate/seed (not Production and RUN_DB_MIGRATE unset). Shared stayright DB is managed by the deploy pipeline.");
}

try
{
    using var adminScope = app.Services.CreateScope();
    await SeedRunner.EnsureAdminUserAsync(
        adminScope.ServiceProvider.GetRequiredService<AppDbContext>(), app.Logger);
}
catch (Exception ex)
{
    app.Logger.LogWarning(ex, "Could not ensure admin user on startup");
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseSerilogRequestLogging();
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}

// Mock 电话录音文件走静态托管(wwwroot/mock-recordings)——真实 Twilio 接入后录音会存在对象存储，
// 这块直接删掉换成真实 URL 即可，不用鉴权保护(跟真实录音 URL 惯例一致，通常是带签名的临时直链)。
app.UseStaticFiles();

app.UseCors(FrontendCorsPolicy);
app.UseAuthentication();
app.UseMiddleware<ForbiddenResponseMiddleware>();
app.UseAuthorization();

app.MapControllers();
app.MapMcp("/mcp");
app.Run();

static string BuildConnectionString(IConfiguration config)
{
    string Env(string key, string pgKey, string fallback) =>
        Environment.GetEnvironmentVariable(key)
        ?? Environment.GetEnvironmentVariable(pgKey)
        ?? config[key]
        ?? config[pgKey]
        ?? fallback;

    // Support both the project's POSTGRES_* names and libpq's standard PG* names.
    // Local dev supplies these via the repo-root .env (SSM tunnel to the shared
    // stayright DB on 127.0.0.1:15432); EC2 supplies them via the systemd unit.
    // The fallbacks match the on-EC2 layout (db container on localhost:5432).
    var host = Env("POSTGRES_HOST", "PGHOST", "localhost");
    var port = Env("POSTGRES_PORT", "PGPORT", "5432");
    var db = Env("POSTGRES_DB", "PGDATABASE", "stayright");
    var user = Env("POSTGRES_USER", "PGUSER", "app");
    var password = Env("POSTGRES_PASSWORD", "PGPASSWORD", "app_password");

    return $"Host={host};Port={port};Database={db};Username={user};Password={password}";
}
