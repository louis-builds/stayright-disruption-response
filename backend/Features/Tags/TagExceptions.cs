namespace TravelDisruptionAgent.Api.Features.Tags;

public class TagNotFoundException() : Exception("Tag not found");

public class TagAccessDeniedException() : Exception("You do not have permission to manage this tag");
