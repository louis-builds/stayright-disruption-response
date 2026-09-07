namespace TravelDisruptionAgent.Api.Features.Cases;

public class CaseNotFoundException() : Exception("Case not found");

public class CaseAccessDeniedException() : Exception("You do not have permission to access this case");

public class CaseAlreadyClosedException() : Exception("This case is already closed");

public class RefundNotConfirmedException() : Exception("Confirm the refund amount before closing with this reason");

public class HotelConfirmationPendingException() : Exception("The guest's selected option is still awaiting hotel confirmation");

public class EscalationNotFoundException() : Exception("This case was never escalated to a coordinator");
