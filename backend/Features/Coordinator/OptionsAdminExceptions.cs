namespace TravelDisruptionAgent.Api.Features.Coordinator;

public class OptionNotFoundException() : Exception("Option not found");

public class OptionLockedException() : Exception("Option is locked; unlock it first before editing");

public class CaseClosedException() : Exception("Case is closed; options can no longer be changed");
