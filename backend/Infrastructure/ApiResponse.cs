namespace TravelDisruptionAgent.Api.Infrastructure;

// 开发规范.md 2.2 节统一响应体，所有 Controller 返回都走这个包装。
public class ApiResponse<T>
{
    public int Code { get; init; }
    public string Message { get; init; } = "ok";
    public T? Data { get; init; }

    public static ApiResponse<T> Ok(T data, string message = "ok") =>
        new() { Code = 0, Message = message, Data = data };

    public static ApiResponse<T> Fail(int code, string message) =>
        new() { Code = code, Message = message, Data = default };
}

public static class ApiResponse
{
    public static ApiResponse<object?> Forbidden() =>
        new() { Code = 403, Message = "You do not have permission to perform this action", Data = null };
}
