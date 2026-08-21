namespace TravelDisruptionAgent.Api.Features.Cases;

public class CaseNotFoundException() : Exception("Case not found");

public class CaseAccessDeniedException() : Exception("You do not have permission to access this case");
