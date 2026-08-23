namespace TravelDisruptionAgent.Api.Features.HotelPortal;

public class HotelNotFoundException() : Exception("No hotel is linked to this account");

public class HotelItemNotFoundException() : Exception("Not found or not owned by this hotel");
