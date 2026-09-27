namespace TravelDisruptionAgent.Api.Features.Calls;

public class CallNotFoundException() : Exception("Call not found");

public class CallAccessDeniedException() : Exception("Call access denied");

public class CallStateConflictException(string message) : Exception(message);

public class CallValidationException(string message) : Exception(message);
